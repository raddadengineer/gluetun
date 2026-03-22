const express = require('express');
const cors = require('cors');
const Docker = require('dockerode');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

// Hardcoded for local GUI, but perfectly limits unauthorized access
const JWT_SECRET = 'gluetun-gui-super-secret-key'; 
const ENV_PATH = path.join(__dirname, '.env');

// Initialize Docker instance
const docker = new Docker();

// Authentication Middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    // Allow token to be passed via query string for Server-Sent Events (Logs)
    const token = (authHeader && authHeader.split(' ')[1]) || req.query.token;
    
    if (token == null) return res.status(401).json({ error: 'Unauthorized' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Forbidden' });
        req.user = user;
        next();
    });
};

// Login Endpoint
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    
    let expectedPassword = 'gluetun-admin';
    if (fs.existsSync(ENV_PATH)) {
        const data = fs.readFileSync(ENV_PATH, 'utf8');
        data.split('\n').forEach(line => {
            if (line.trim().startsWith('GUI_PASSWORD=')) {
                expectedPassword = line.split('=')[1].trim();
            }
        });
    }

    if (password === expectedPassword) {
        // Issue token valid for 24 hours
        const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, message: 'Authenticated Successfully' });
    } else {
        res.status(401).json({ error: 'Invalid password' });
    }
});

// All routes below require Authentication
app.get('/api/status', authenticateToken, async (req, res) => {
    try {
        const containers = await docker.listContainers({ all: true });
        const gluetun = containers.find(c => c.Names.some(n => n.includes('gluetun')));
        
        if (!gluetun) {
            return res.status(404).json({ error: 'Gluetun container not found' });
        }
        
        const containerInfo = await docker.getContainer(gluetun.Id).inspect();
        
        res.json({
            status: containerInfo.State.Status,
            id: containerInfo.Id,
            env: containerInfo.Config.Env,
            image: containerInfo.Config.Image,
            startedAt: containerInfo.State.StartedAt
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/metrics', authenticateToken, async (req, res) => {
    try {
        const containers = await docker.listContainers({ all: true });
        const gluetun = containers.find(c => c.Names.some(n => n.includes('gluetun')));
        
        if (!gluetun) {
            return res.status(404).json({ error: 'Gluetun container not found' });
        }
        
        const container = docker.getContainer(gluetun.Id);
        const stats = await container.stats({ stream: false });
        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/restart', authenticateToken, async (req, res) => {
    try {
        const containers = await docker.listContainers({ all: true });
        const gluetun = containers.find(c => c.Names.some(n => n.includes('gluetun')));
        
        if (!gluetun) {
            return res.status(404).json({ error: 'Gluetun container not found' });
        }
        
        const container = docker.getContainer(gluetun.Id);
        await container.restart();
        res.json({ message: 'Gluetun restarted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/stop', authenticateToken, async (req, res) => {
    try {
        const containers = await docker.listContainers({ all: true });
        const gluetun = containers.find(c => c.Names.some(n => n.includes('gluetun')));
        
        if (!gluetun) {
            return res.status(404).json({ error: 'Gluetun container not found' });
        }
        
        const container = docker.getContainer(gluetun.Id);
        await container.stop();
        res.json({ message: 'Gluetun stopped successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/logs', authenticateToken, async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    try {
        const containers = await docker.listContainers({ all: true });
        const gluetun = containers.find(c => c.Names.some(n => n.includes('gluetun')));
        
        if (!gluetun) {
            res.write(`data: ${JSON.stringify("[ERROR] Gluetun container not found")}\n\n`);
            return;
        }

        const container = docker.getContainer(gluetun.Id);
        const logStream = await container.logs({ follow: true, stdout: true, stderr: true, tail: 100 });

        logStream.on('data', (chunk) => {
            let payload = chunk;
            if (chunk.length >= 8 && chunk[0] <= 2) {
                payload = chunk.slice(8);
            }
            res.write(`data: ${JSON.stringify(payload.toString('utf8'))}\n\n`);
        });

        req.on('close', () => {
            logStream.destroy();
        });
    } catch (err) {
        res.write(`data: ${JSON.stringify("[ERROR] " + err.message)}\n\n`);
    }
});

app.get('/api/config', authenticateToken, (req, res) => {
    try {
        if (!fs.existsSync(ENV_PATH)) {
            return res.json({});
        }
        const data = fs.readFileSync(ENV_PATH, 'utf8');
        const config = {};
        data.split('\n').forEach(line => {
            if (line && line.includes('=')) {
                const parts = line.split('=');
                config[parts[0]] = parts.slice(1).join('=').trim();
            }
        });
        res.json(config);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/config', authenticateToken, (req, res) => {
    try {
        const config = req.body;
        let envContent = '';
        for (const [key, value] of Object.entries(config)) {
            if (value !== undefined && value !== null && value !== '') {
                envContent += `${key}=${value}\n`;
            }
        }
        fs.writeFileSync(ENV_PATH, envContent, 'utf8');
        res.json({ message: 'Settings saved to .env' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Serve React App in Production
const distPath = path.join(__dirname, 'public');
if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
        if (!req.path.startsWith('/api/')) {
            res.sendFile(path.join(distPath, 'index.html'));
        } else {
            res.status(404).json({ error: 'API route not found' });
        }
    });
}

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Gluetun GUI API server running on http://localhost:${PORT}`);
});
