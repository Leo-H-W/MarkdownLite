const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');
const { marked } = require('marked');
const { renderMarkdown } = require('./public/md-render.js');
const os = require('os');

const app = express();
const PORT = 3456;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const isWindows = os.platform() === 'win32';

// POST /api/select-folder - open system folder dialog
app.post('/api/select-folder', (req, res) => {
  console.log('[MarkdownLite] /api/select-folder requested');
  if (!isWindows) {
    return res.status(500).json({ error: 'Folder dialog is only supported on Windows' });
  }

  const psScript = `
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    Add-Type -AssemblyName System.Windows.Forms
    $owner = New-Object System.Windows.Forms.Form
    $owner.TopMost = $true
    $fbd = New-Object System.Windows.Forms.FolderBrowserDialog
    $fbd.Description = "请选择要加载的 Markdown 文件夹"
    $fbd.ShowNewFolderButton = $false
    $result = $fbd.ShowDialog($owner)
    $owner.Dispose()
    if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
      Write-Output $fbd.SelectedPath
    } else {
      Write-Output "__CANCELLED__"
    }
  `;

  const scriptBuffer = Buffer.from(psScript, 'utf16le');
  const encodedCommand = scriptBuffer.toString('base64');

  const child = spawn('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', encodedCommand
  ], {
    windowsHide: true
  });

  let stdout = '';
  let stderr = '';

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (data) => {
    stdout += data;
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (data) => {
    stderr += data;
  });

  const timeout = setTimeout(() => {
    child.kill();
    return res.status(500).json({ error: 'Folder dialog timed out' });
  }, 30000);

  child.on('close', (code) => {
    clearTimeout(timeout);
    if (code !== 0) {
      console.error('PowerShell stderr:', stderr);
      return res.status(500).json({ error: 'Failed to open folder dialog' });
    }

    const selectedPath = stdout.trim();
    if (selectedPath === '__CANCELLED__') {
      return res.json({ cancelled: true });
    }

    if (!selectedPath || !fs.existsSync(selectedPath)) {
      return res.status(400).json({ error: 'Invalid or non-existent path selected' });
    }

    const stats = fs.statSync(selectedPath);
    if (!stats.isDirectory()) {
      return res.status(400).json({ error: 'Selected path is not a directory' });
    }

    res.json({ path: selectedPath });
  });
});

// POST /api/load - load folder and optionally a specific file
app.post('/api/load', (req, res) => {
  const { folderPath, filePath } = req.body;

  if (!folderPath) {
    return res.status(400).json({ error: 'folderPath is required' });
  }

  const resolvedFolder = path.resolve(folderPath);

  if (!fs.existsSync(resolvedFolder)) {
    return res.status(404).json({ error: 'Directory does not exist: ' + resolvedFolder });
  }

  const stats = fs.statSync(resolvedFolder);
  if (!stats.isDirectory()) {
    return res.status(400).json({ error: 'Path is not a directory: ' + resolvedFolder });
  }

  // Scan for markdown files
  let files = [];
  try {
    const entries = fs.readdirSync(resolvedFolder);
    files = entries
      .filter(f => {
        const ext = path.extname(f).toLowerCase();
        return ext === '.md' || ext === '.markdown';
      })
      .map(f => ({
        name: f,
        fullPath: path.join(resolvedFolder, f)
      }));
  } catch (err) {
    return res.status(500).json({ error: 'Failed to read directory: ' + err.message });
  }

  // Determine which file to load
  let targetFile = filePath ? path.resolve(filePath) : null;
  if (!targetFile && files.length > 0) {
    targetFile = files[0].fullPath;
  }

  let content = '';
  let html = '';
  let currentFile = null;

  if (targetFile) {
    if (!fs.existsSync(targetFile)) {
      return res.status(404).json({ error: 'File does not exist: ' + targetFile });
    }

    const fileStats = fs.statSync(targetFile);
    if (!fileStats.isFile()) {
      return res.status(400).json({ error: 'Path is not a file: ' + targetFile });
    }

    try {
      content = fs.readFileSync(targetFile, 'utf-8');
      html = renderMarkdown(content, marked);
      currentFile = targetFile;
    } catch (err) {
      return res.status(500).json({ error: 'Failed to read file: ' + err.message });
    }
  }

  res.json({
    folderPath: resolvedFolder,
    files,
    currentFile,
    content,
    html
  });
});

// GET /api/file - read a specific file
app.get('/api/file', (req, res) => {
  const filePath = req.query.path;

  if (!filePath) {
    return res.status(400).json({ error: 'path query parameter is required' });
  }

  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    return res.status(404).json({ error: 'File does not exist: ' + resolvedPath });
  }

  const stats = fs.statSync(resolvedPath);
  if (!stats.isFile()) {
    return res.status(400).json({ error: 'Path is not a file: ' + resolvedPath });
  }

  try {
    const content = fs.readFileSync(resolvedPath, 'utf-8');
    const html = renderMarkdown(content, marked);
    res.json({ content, html, path: resolvedPath });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read file: ' + err.message });
  }
});

// POST /api/refresh - refresh current file
app.post('/api/refresh', (req, res) => {
  const { filePath } = req.body;

  if (!filePath) {
    return res.status(400).json({ error: 'filePath is required' });
  }

  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    return res.status(404).json({ error: 'File does not exist: ' + resolvedPath });
  }

  const stats = fs.statSync(resolvedPath);
  if (!stats.isFile()) {
    return res.status(400).json({ error: 'Path is not a file: ' + resolvedPath });
  }

  try {
    const content = fs.readFileSync(resolvedPath, 'utf-8');
    const html = renderMarkdown(content, marked);
    res.json({ content, html, path: resolvedPath });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read file: ' + err.message });
  }
});

const url = `http://localhost:${PORT}`;
const DAEMON_ENV = 'MARKDOWNLITE_DAEMON';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function openBrowser(url) {
  const platform = os.platform();
  let command, args;
  if (platform === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', '', url];
  } else if (platform === 'darwin') {
    command = 'open';
    args = [url];
  } else {
    command = 'xdg-open';
    args = [url];
  }
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

function isPortInUse(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', (err) => {
        resolve(err.code === 'EADDRINUSE');
      })
      .once('listening', () => {
        tester.once('close', () => resolve(false));
        tester.close();
      })
      .listen(port);
  });
}

function spawnDaemon() {
  const child = spawn(process.execPath, [__filename], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, [DAEMON_ENV]: '1' }
  });
  child.unref();
}

function runDaemon() {
  const server = app.listen(PORT, () => {
    // 服务已在后台运行，不自动打开浏览器，避免重复打开新标签页
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use.`);
      process.exit(1);
    } else {
      console.error('Server error:', err.message);
      process.exit(1);
    }
  });
}

async function main() {
  if (process.env[DAEMON_ENV] === '1') {
    runDaemon();
    return;
  }

  const portBusy = await isPortInUse(PORT);

  if (!portBusy) {
    spawnDaemon();
    console.log(`MarkdownLite started at ${url}`);
    await sleep(2000);
    openBrowser(url);
    process.exit(0);
  }

  console.log(`\n端口 ${PORT} 已被占用，MarkdownLite 可能已在运行。`);
  console.log(`打开访问地址: ${url}`);
  openBrowser(url);
  process.exit(0);
}

main();
