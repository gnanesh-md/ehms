import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isWin = process.platform === 'win32';

function killProcessTree(pid) {
  if (isWin) {
    try {
      spawn('taskkill', ['/pid', pid.toString(), '/T', '/F'], { stdio: 'ignore' });
    } catch (_) {}
  } else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch (_) {}
  }
}

function freePort(port) {
  if (isWin) {
    try {
      const output = execSync('netstat -ano -p tcp', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const lines = output.split('\n');
      const pids = new Set();
      for (const line of lines) {
        if (line.includes(`:${port}`) && line.includes('LISTENING')) {
          const parts = line.trim().split(/\s+/);
          const pid = parseInt(parts[parts.length - 1], 10);
          if (pid && pid !== process.pid && pid > 4) {
            pids.add(pid);
          }
        }
      }
      for (const pid of pids) {
        try {
          const taskInfo = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).toLowerCase();
          // Only kill previous node or python server processes, never IDE or system processes
          if (taskInfo.includes('node.exe') || taskInfo.includes('python.exe')) {
            execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
          }
        } catch (_) {}
      }
    } catch (_) {}
  } else {
    try {
      execSync(`fuser -k ${port}/tcp`, { stdio: 'ignore' });
    } catch (_) {}
  }
}

const processes = [];

function startProcess(name, cmd, args, cwd, env = {}) {
  const fullEnv = { ...process.env, ...env };
  const child = spawn(cmd, args, {
    cwd,
    env: fullEnv,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  processes.push({ name, child });

  child.stdout.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    for (const line of lines) {
      if (line.trim()) console.log(`[${name}] ${line.trim()}`);
    }
  });

  child.stderr.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    for (const line of lines) {
      if (line.trim()) console.error(`[${name}] ${line.trim()}`);
    }
  });

  child.on('exit', (code, signal) => {
    console.log(`[${name}] process exited with code ${code} / signal ${signal}`);
  });

  return child;
}

console.log('========================================================');
console.log(' Starting Enterprise Hospital Management System (EHMS)');
console.log('========================================================\n');

// Pre-flight check: free ports from previous orphaned runs if any
[8010, 8011, 3000, 8443].forEach(freePort);

const defaultDbUrl = 'postgresql://postgres:Admin%40123@localhost:5432/hospai';
const defaultHrmsDbUrl = 'postgresql://postgres:Admin%40123@localhost:5432/hospai_enterprise';

// 1. Start Python Backend (Flask Monolith on port 8010)
const backendEnv = {
  PORT: process.env.PORT || '8010',
  DATABASE_URL: process.env.DATABASE_URL || defaultDbUrl,
  REDIS_URL: process.env.REDIS_URL || 'memory://',
  CELERY_TASK_ALWAYS_EAGER: 'true',
  CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:8443,http://localhost:5173,http://127.0.0.1:8443,http://127.0.0.1:5173',
  SESSION_COOKIE_SECURE: 'false',
  SEED_DEMO_USERS: 'false',
  SEED_INITIAL_ADMIN: 'true',
  SESSION_PEPPER: 'f4b7a1c8d2e3f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0',
  SETTINGS_ENCRYPTION_KEY: 'e1d2c3b4a5f60718293a4b5c6d7e8f90',
  PYTHONUNBUFFERED: '1',
};
console.log('-> Launching Hospital Core Backend on :8010...');
startProcess('Backend', 'python', ['app.py'], path.join(__dirname, 'backend', 'backend'), backendEnv);

// 2. Start Node HRMS Server (Express on port 8011)
const hrmsEnv = {
  HRMS_PORT: process.env.HRMS_PORT || '8011',
  HRMS_DATABASE_URL: process.env.HRMS_DATABASE_URL || defaultHrmsDbUrl,
  CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:8443,http://localhost:5173,http://127.0.0.1:8443,http://127.0.0.1:5173',
};
console.log('-> Launching HRMS Backend on :8011...');
startProcess('HRMS', 'node', ['server/app.mjs'], path.join(__dirname, 'frontend'), hrmsEnv);

// 3. Start Keppler OCR Frontend (Vite on port 3000)
console.log('-> Launching Keppler OCR UI on :3000...');
startProcess('OCR-UI', 'npx', ['vite', '--port', '3000', '--host'], path.join(__dirname, 'ocr-frontend'), {});

// 4. Start Hospital Main Frontend (Vite on port 8443)
console.log('-> Launching Hospital Main Web Application on :8443...');
startProcess('Frontend', 'npx', ['vite', '--port', '8443', '--host'], path.join(__dirname, 'frontend'), {
  PORT: '8443',
});

let isCleaningUp = false;
function cleanup() {
  if (isCleaningUp) return;
  isCleaningUp = true;
  console.log('\nShutting down all services...');
  for (const { name, child } of processes) {
    if (child.pid) {
      console.log(`Stopping ${name} (PID ${child.pid})...`);
      killProcessTree(child.pid);
    }
  }
  setTimeout(() => process.exit(0), 1000);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', () => {
  for (const { child } of processes) {
    if (child.pid) killProcessTree(child.pid);
  }
});
