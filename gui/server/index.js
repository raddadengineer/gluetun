const express = require('express');
const cors = require('cors');
const Docker = require('dockerode');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { exec } = require('child_process');

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

// PIA WireGuard Config Generation
let piaRefreshStatus = { state: 'idle', message: 'No generation attempted yet', lastGenerated: null, failCount: 0 };

app.get('/api/pia/status', authenticateToken, (req, res) => {
    res.json(piaRefreshStatus);
});

// Proxy PIA server list to avoid CORS issues in browser
app.get('/api/pia/regions', async (req, res) => {
    try {
        const https = require('https');
        const data = await new Promise((resolve, reject) => {
            https.get('https://serverlist.piaservers.net/vpninfo/servers/v6', (resp) => {
                let raw = '';
                resp.on('data', chunk => raw += chunk);
                resp.on('end', () => resolve(raw));
            }).on('error', reject);
        });
        const jsonStr = data.split('\n')[0];
        const parsed = JSON.parse(jsonStr);
        const regions = parsed.regions
            .filter(r => !r.offline)
            .map(r => ({ id: r.id, name: r.name, portForward: r.port_forward }))
            .sort((a, b) => a.name.localeCompare(b.name));
        res.json(regions);
    } catch (err) {
        console.error('[PIA-Regions] Error:', err.message);
        res.status(500).json({ error: 'Failed to fetch PIA regions' });
    }
});

app.post('/api/pia/generate', authenticateToken, async (req, res) => {
    const { PIA_USERNAME, PIA_PASSWORD, PIA_REGION, PIA_PORT_FORWARDING } = req.body;

    if (!PIA_USERNAME || !PIA_PASSWORD || !PIA_REGION) {
        return res.status(400).json({ error: 'PIA_USERNAME, PIA_PASSWORD, and PIA_REGION are required.' });
    }

    piaRefreshStatus = { state: 'generating', message: 'Generating WireGuard config...', lastGenerated: null, failCount: 0 };

    const pfFlag = PIA_PORT_FORWARDING === 'true' ? ' -p' : '';
    const safeRegion = PIA_REGION.replace(/[^a-zA-Z0-9_-]/g, '');
    // pia-wg-config expects: pia-wg-config [flags] <username> <password>
    const cmd = `/usr/local/bin/pia-wg-config -o /config/wg0.conf -r ${safeRegion} -s -v${pfFlag} "${PIA_USERNAME}" "${PIA_PASSWORD}"`;

    console.log('[PIA-Generate] Running command:', cmd.replace(PIA_PASSWORD, '***'));

    try {
        const result = await new Promise((resolve, reject) => {
            exec(cmd, { timeout: 30000 }, (error, stdout, stderr) => {
                console.log('[PIA-Generate] stdout:', stdout);
                console.log('[PIA-Generate] stderr:', stderr);
                if (error) {
                    reject(new Error(stderr || stdout || error.message));
                } else {
                    resolve(stdout + stderr);
                }
            });
        });

        // Parse the generated wg0.conf for WireGuard values
        let privateKey = '', address = '', endpoint = '', publicKey = '', serverName = null;
        try {
            if (fs.existsSync('/config/wg0.conf')) {
                const wgConf = fs.readFileSync('/config/wg0.conf', 'utf8');
                console.log('[PIA-Generate] Generated wg0.conf:', wgConf);

                const pkMatch = wgConf.match(/PrivateKey\s*=\s*(.+)/);
                if (pkMatch) privateKey = pkMatch[1].trim();

                const addrMatch = wgConf.match(/Address\s*=\s*(.+)/);
                if (addrMatch) address = addrMatch[1].trim();

                const epMatch = wgConf.match(/Endpoint\s*=\s*(.+)/);
                if (epMatch) endpoint = epMatch[1].trim();

                const pubMatch = wgConf.match(/PublicKey\s*=\s*(.+)/);
                if (pubMatch) publicKey = pubMatch[1].trim();

                const serverMatch = wgConf.match(/#\s*Server:\s*(.+)/);
                if (serverMatch) serverName = serverMatch[1].trim();
            }
        } catch (e) {
            console.error('[PIA-Generate] Error parsing wg0.conf:', e.message);
        }

        if (!privateKey) {
            throw new Error('Failed to parse PrivateKey from generated wg0.conf. The file may be corrupted.');
        }

        // Parse endpoint into IP and port
        let endpointIP = '', endpointPort = '1337';
        if (endpoint) {
            const epParts = endpoint.split(':');
            endpointIP = epParts[0];
            if (epParts[1]) endpointPort = epParts[1];
        }

        // Write Gluetun env file with parsed WireGuard values
        const GLUETUN_ENV_PATH = '/gluetun.env';
        const gluetunEnv = [
            'VPN_SERVICE_PROVIDER=custom',
            'VPN_TYPE=wireguard',
            `WIREGUARD_PRIVATE_KEY=${privateKey}`,
            `WIREGUARD_ADDRESSES=${address}`,
            `VPN_ENDPOINT_IP=${endpointIP}`,
            `VPN_ENDPOINT_PORT=${endpointPort}`,
            `WIREGUARD_PUBLIC_KEY=${publicKey}`,
        ].join('\n') + '\n';

        fs.writeFileSync(GLUETUN_ENV_PATH, gluetunEnv, 'utf8');
        console.log('[PIA-Generate] Wrote gluetun.env:', gluetunEnv);

        // Save PIA credentials to GUI .env for persistence
        let envVars = {};
        if (fs.existsSync(ENV_PATH)) {
            const data = fs.readFileSync(ENV_PATH, 'utf8');
            data.split('\n').forEach(line => {
                if (line && line.includes('=')) {
                    const parts = line.split('=');
                    envVars[parts[0]] = parts.slice(1).join('=').trim();
                }
            });
        }
        envVars.PIA_USERNAME = PIA_USERNAME;
        envVars.PIA_PASSWORD = PIA_PASSWORD;
        envVars.PIA_REGION = PIA_REGION;
        envVars.PIA_PORT_FORWARDING = PIA_PORT_FORWARDING || 'false';
        envVars.VPN_SERVICE_PROVIDER = 'private internet access';
        envVars.VPN_TYPE = 'wireguard';
        if (serverName) envVars.SERVER_NAMES = serverName;

        let newEnv = '';
        for (const [k, v] of Object.entries(envVars)) {
            newEnv += `${k}=${v}\n`;
        }
        fs.writeFileSync(ENV_PATH, newEnv, 'utf8');

        // Recreate Gluetun container with new WireGuard env vars via Dockerode
        const newEnvArray = [
            'VPN_SERVICE_PROVIDER=custom',
            'VPN_TYPE=wireguard',
            `WIREGUARD_PRIVATE_KEY=${privateKey}`,
            `WIREGUARD_ADDRESSES=${address}`,
            `VPN_ENDPOINT_IP=${endpointIP}`,
            `VPN_ENDPOINT_PORT=${endpointPort}`,
            `WIREGUARD_PUBLIC_KEY=${publicKey}`,
        ];

        let restartMsg = '';
        try {
            const containers = await docker.listContainers({ all: true });
            const gluetunInfo = containers.find(c => c.Names.some(n => n.includes('gluetun') && !n.includes('gui')));
            if (gluetunInfo) {
                const oldContainer = docker.getContainer(gluetunInfo.Id);
                const inspectData = await oldContainer.inspect();

                // Stop and remove old container
                await oldContainer.stop().catch(() => { });
                await oldContainer.remove().catch(() => { });

                // Rebuild config from inspected container, replacing env vars
                const oldConfig = inspectData.Config;
                const hostConfig = inspectData.HostConfig;

                // Merge: keep non-VPN/WG env vars from old config, add new VPN ones
                const keysToReplace = new Set(newEnvArray.map(e => e.split('=')[0]));
                const filteredOldEnv = (oldConfig.Env || []).filter(e => !keysToReplace.has(e.split('=')[0]));
                const mergedEnv = [...filteredOldEnv, ...newEnvArray];

                const createOpts = {
                    name: inspectData.Name.replace(/^\//, ''),
                    Image: oldConfig.Image,
                    Env: mergedEnv,
                    ExposedPorts: oldConfig.ExposedPorts,
                    HostConfig: {
                        ...hostConfig,
                        // Preserve existing mounts, port bindings, cap_add, devices
                    },
                    Labels: oldConfig.Labels,
                };

                const newContainer = await docker.createContainer(createOpts);
                await newContainer.start();
                restartMsg = ' Gluetun recreated with new WireGuard config.';
                console.log('[PIA-Generate] Gluetun container recreated successfully');
            } else {
                restartMsg = ' Warning: Gluetun container not found.';
            }
        } catch (restartErr) {
            console.error('[PIA-Generate] Gluetun recreate failed:', restartErr.message);
            restartMsg = ' Note: Please manually run "docker compose up -d gluetun" on the host to apply the new config.';
        }

        piaRefreshStatus = {
            state: 'success',
            message: `Config generated (key: ...${privateKey.slice(-8)})${serverName ? ` server: ${serverName}` : ''}.${restartMsg}`,
            lastGenerated: new Date().toISOString(),
            failCount: 0
        };

        res.json({
            message: `WireGuard config generated!${restartMsg} Private key and endpoint written to Gluetun env.`,
            serverName,
            generatedAt: piaRefreshStatus.lastGenerated
        });
    } catch (err) {
        piaRefreshStatus = {
            state: 'error',
            message: err.message,
            lastGenerated: null,
            failCount: piaRefreshStatus.failCount + 1
        };
        res.status(500).json({ error: 'Config generation failed: ' + err.message });
    }
});

// Serve React App in Production
const distPath = path.join(__dirname, 'public');
if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.use((req, res) => {
        if (!req.path.startsWith('/api/')) {
            res.sendFile(path.join(distPath, 'index.html'));
        } else {
            res.status(404).json({ error: 'API route not found' });
        }
    });
}

// Background PIA-Refresh Checker
let failCount = 0;
const FAIL_THRESHOLD = 3;
const CHECK_INTERVAL = 60 * 1000;
const HEALTHY_CHECK_INTERVAL = 30 * 60 * 1000;

async function checkVPN() {
    try {
        const containers = await docker.listContainers({ all: true });
        const gluetun = containers.find(c => c.Names.some(n => n.includes('gluetun') && !n.includes('gui')));
        if (!gluetun) return setTimeout(checkVPN, CHECK_INTERVAL);

        const container = docker.getContainer(gluetun.Id);
        const execContext = await container.exec({
            Cmd: ['sh', '-c', 'curl -s http://127.0.0.1:8000/v1/publicip/ip || echo "curl_failed"'],
            AttachStdout: true,
            AttachStderr: true
        });

        const stream = await execContext.start({ hijack: true, stdin: true });
        let output = await new Promise((resolve) => {
            let data = '';
            stream.on('data', chunk => {
                const payload = chunk.length >= 8 && chunk[0] <= 2 ? chunk.slice(8) : chunk;
                data += payload.toString('utf8');
            });
            stream.on('end', () => resolve(data.trim()));
        });

        if (output && output.includes('public_ip')) {
            failCount = 0;
            return setTimeout(checkVPN, HEALTHY_CHECK_INTERVAL);
        } else {
            failCount++;
        }
    } catch (err) {
        failCount++;
    }

    if (failCount >= FAIL_THRESHOLD) {
        console.log(`[PIA-Refresh] VPN failed ${failCount} times. Regenerating config...`);
        let envVars = {};
        if (fs.existsSync(ENV_PATH)) {
            const data = fs.readFileSync(ENV_PATH, 'utf8');
            data.split('\n').forEach(line => {
                if (line && line.includes('=')) {
                    const parts = line.split('=');
                    envVars[parts[0]] = parts.slice(1).join('=').trim();
                }
            });
        }

        const { PIA_USERNAME, PIA_PASSWORD, PIA_REGION, SERVER_NAMES, PIA_PORT_FORWARDING } = envVars;
        if (PIA_USERNAME && PIA_PASSWORD && (PIA_REGION || SERVER_NAMES)) {
            const regionFlag = SERVER_NAMES ? `-server ${SERVER_NAMES}` : `-region ${PIA_REGION}`;
            const pfFlag = PIA_PORT_FORWARDING === 'true' ? '-pf' : '';
            const cmd = `PIA_USER=${PIA_USERNAME} PIA_PASS=${PIA_PASSWORD} pia-wg-config ${regionFlag} ${pfFlag} > /config/wg0.conf`;

            exec(cmd, async (error, stdout, stderr) => {
                if (!error || stdout.includes('success') || fs.existsSync('/config/wg0.conf')) {
                    console.log('[PIA-Refresh] Config regenerated. Restarting Gluetun...');
                    try {
                        if (fs.existsSync('/config/wg0.conf')) {
                            const wgConf = fs.readFileSync('/config/wg0.conf', 'utf8');
                            const serverMatch = wgConf.match(/Server:\s*([^\s]+)/);
                            if (serverMatch && serverMatch[1] && PIA_PORT_FORWARDING === 'true' && envVars.SERVER_NAMES !== serverMatch[1]) {
                                envVars.SERVER_NAMES = serverMatch[1];
                                let newEnv = '';
                                for (const [k, v] of Object.entries(envVars)) {
                                    newEnv += `${k}=${v}\n`;
                                }
                                fs.writeFileSync(ENV_PATH, newEnv, 'utf8');
                                console.log(`[PIA-Refresh] Auto-updated SERVER_NAMES to ${serverMatch[1]} in .env`);
                            }
                        }
                    } catch (err) {
                        console.error('[PIA-Refresh] Failed to parse wg0.conf server name', err.message);
                    }

                    const containers = await docker.listContainers({ all: true });
                    const gluetun = containers.find(c => c.Names.some(n => n.includes('gluetun') && !n.includes('gui')));
                    if (gluetun) {
                        await docker.getContainer(gluetun.Id).restart();
                    }
                    failCount = 0;
                } else {
                    console.error('[PIA-Refresh] Config generation failed:', stderr || stdout);
                }
            });
        } else {
            console.error('[PIA-Refresh] Missing PIA credentials in GUI .env to regenerate config.');
        }
    }
    setTimeout(checkVPN, CHECK_INTERVAL);
}

// Start checker after a short delay
setTimeout(checkVPN, 15000);

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Gluetun GUI API server running on http://localhost:${PORT}`);
});
