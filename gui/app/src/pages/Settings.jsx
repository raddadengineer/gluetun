import { useEffect, useState } from 'react';

export default function Settings() {
  const [config, setConfig] = useState({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [activeTab, setActiveTab] = useState('general');

  // PIA WireGuard state
  const [piaUsername, setPiaUsername] = useState('');
  const [piaPassword, setPiaPassword] = useState('');
  const [piaRegion, setPiaRegion] = useState('');
  const [piaPortForwarding, setPiaPortForwarding] = useState(false);
  const [piaGenerating, setPiaGenerating] = useState(false);
  const [piaStatus, setPiaStatus] = useState(null);
  const [piaRegions, setPiaRegions] = useState([]);

  // Load from `.env` via our backend
  useEffect(() => {
    const token = localStorage.getItem('token');
    fetch('/api/config', { headers: { 'Authorization': `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => {
        setConfig(data);
        if (data.PIA_USERNAME) setPiaUsername(data.PIA_USERNAME);
        if (data.PIA_PASSWORD) setPiaPassword(data.PIA_PASSWORD);
        if (data.PIA_REGION) setPiaRegion(data.PIA_REGION);
        if (data.PIA_PORT_FORWARDING === 'true') setPiaPortForwarding(true);
      })
      .catch(console.error);

    fetch('/api/pia/status', { headers: { 'Authorization': `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => setPiaStatus(data))
      .catch(console.error);

    // Fetch PIA regions via backend proxy (avoids CORS)
    fetch('/api/pia/regions')
      .then(r => r.json())
      .then(regions => { if (Array.isArray(regions)) setPiaRegions(regions); })
      .catch(console.error);
  }, []);

  const fetchPiaRegions = () => {
    fetch('/api/pia/regions')
      .then(r => r.json())
      .then(regions => { if (Array.isArray(regions)) setPiaRegions(regions); })
      .catch(console.error);
  };

  const handlePiaGenerate = async () => {
    setPiaGenerating(true);
    setMessage(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/pia/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          PIA_USERNAME: piaUsername,
          PIA_PASSWORD: piaPassword,
          PIA_REGION: piaRegion,
          PIA_PORT_FORWARDING: piaPortForwarding ? 'true' : 'false'
        })
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: 'success', text: data.message });
        setPiaStatus({ state: 'success', message: data.message, lastGenerated: data.generatedAt, failCount: 0 });
      } else {
        setMessage({ type: 'error', text: data.error || 'Generation failed.' });
        setPiaStatus({ state: 'error', message: data.error, lastGenerated: null, failCount: (piaStatus?.failCount || 0) + 1 });
      }
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
    setPiaGenerating(false);
    setTimeout(() => setMessage(null), 5000);
  };

  const handleChange = (e) => {
    const value = e.target.type === 'checkbox' ? (e.target.checked ? 'on' : 'off') : e.target.value;
    setConfig({ ...config, [e.target.name]: value });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(config)
      });
      if (res.ok) {
        setMessage({ type: 'success', text: 'All settings securely saved to .env file!' });
      } else {
        setMessage({ type: 'error', text: 'Failed to save settings.' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
    setSaving(false);
    setTimeout(() => setMessage(null), 3000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <header className="header" style={{ marginBottom: 0 }}>
          <div className="header-title">
            <h2>Settings</h2>
            <p>Manage your entire Gluetun VPN configuration from one screen</p>
          </div>
        </header>

        <button type="button" onClick={handleSave} className="btn btn-primary" disabled={saving}>
          <span className="material-icons-round">save</span>
          {saving ? 'Saving...' : 'Save All Changes'}
        </button>
      </div>

      {message && (
        <div style={{
          padding: '16px',
          borderRadius: '8px',
          background: message.type === 'success' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
          border: `1px solid ${message.type === 'success' ? 'var(--success)' : 'var(--danger)'}`,
          color: message.type === 'success' ? 'var(--success)' : 'var(--danger)'
        }}>
          {message.text}
        </div>
      )}

      <div className="tabs-container">
        <button className={`tab-btn ${activeTab === 'general' ? 'active' : ''}`} onClick={() => setActiveTab('general')}>
          <span className="material-icons-round">vpn_key</span> VPN Provider
        </button>
        <button className={`tab-btn ${activeTab === 'dns' ? 'active' : ''}`} onClick={() => setActiveTab('dns')}>
          <span className="material-icons-round">security</span> DNS & Adblock
        </button>
        <button className={`tab-btn ${activeTab === 'network' ? 'active' : ''}`} onClick={() => setActiveTab('network')}>
          <span className="material-icons-round">router</span> Network & Ports
        </button>
        <button className={`tab-btn ${activeTab === 'proxies' ? 'active' : ''}`} onClick={() => setActiveTab('proxies')}>
          <span className="material-icons-round">cell_wifi</span> Local Proxies
        </button>
      </div>

      <div className="glass-panel" style={{ padding: '32px' }}>
        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

          {activeTab === 'general' && (
            <>
              <div className="form-group">
                <label>VPN Service Provider</label>
                <select name="VPN_SERVICE_PROVIDER" value={config.VPN_SERVICE_PROVIDER || ''} onChange={handleChange} className="select-input">
                  <option value="">Select a provider...</option>
                  <option value="airvpn">AirVPN</option>
                  <option value="custom">Custom</option>
                  <option value="cyberghost">CyberGhost</option>
                  <option value="expressvpn">ExpressVPN</option>
                  <option value="ivpn">IVPN</option>
                  <option value="mullvad">Mullvad</option>
                  <option value="nordvpn">NordVPN</option>
                  <option value="private internet access">Private Internet Access</option>
                  <option value="protonvpn">ProtonVPN</option>
                  <option value="surfshark">Surfshark</option>
                  <option value="windscribe">Windscribe</option>
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                <div className="form-group">
                  <label>VPN Type</label>
                  <select name="VPN_TYPE" value={config.VPN_TYPE || ''} onChange={handleChange} className="select-input">
                    <option value="wireguard">WireGuard</option>
                    <option value="openvpn">OpenVPN</option>
                  </select>
                </div>
                {config.VPN_SERVICE_PROVIDER !== 'private internet access' && (
                  <div className="form-group">
                    <label>Server Countries</label>
                    <input type="text" name="SERVER_COUNTRIES" value={config.SERVER_COUNTRIES || ''} onChange={handleChange} className="text-input" placeholder="e.g. Switzerland, Romania" />
                  </div>
                )}
              </div>

              {config.VPN_SERVICE_PROVIDER !== 'private internet access' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                  <div className="form-group">
                    <label>Server Cities</label>
                    <input type="text" name="SERVER_CITIES" value={config.SERVER_CITIES || ''} onChange={handleChange} className="text-input" placeholder="e.g. New York, London" />
                  </div>
                  <div className="form-group">
                    <label>Server Hostnames</label>
                    <input type="text" name="SERVER_HOSTNAMES" value={config.SERVER_HOSTNAMES || ''} onChange={handleChange} className="text-input" placeholder="e.g. us-nyc1.server.com" />
                  </div>
                </div>
              )}

              {/* PIA + WireGuard: Show integrated generator */}
              {config.VPN_SERVICE_PROVIDER === 'private internet access' && (config.VPN_TYPE || 'wireguard') === 'wireguard' && (
                <>
                  <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)', margin: '12px 0' }} />

                  <div style={{ padding: '16px', borderRadius: '8px', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid var(--glass-highlight)' }}>
                    <p style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                      <span className="material-icons-round" style={{ color: 'var(--accent-primary)' }}>vpn_lock</span>
                      Enter your PIA credentials below to automatically generate WireGuard keys and connect. Credentials are saved for automatic background refresh when sessions expire.
                    </p>
                  </div>

                  {piaStatus && piaStatus.state !== 'idle' && (
                    <div style={{
                      padding: '16px', borderRadius: '10px',
                      background: piaStatus.state === 'success' ? 'rgba(16, 185, 129, 0.1)' : piaStatus.state === 'error' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(59, 130, 246, 0.1)',
                      border: `1px solid ${piaStatus.state === 'success' ? 'var(--success)' : piaStatus.state === 'error' ? 'var(--danger)' : 'var(--accent-primary)'}`,
                      display: 'flex', alignItems: 'center', gap: '12px'
                    }}>
                      <span className="material-icons-round" style={{ color: piaStatus.state === 'success' ? 'var(--success)' : piaStatus.state === 'error' ? 'var(--danger)' : 'var(--accent-primary)' }}>
                        {piaStatus.state === 'success' ? 'check_circle' : piaStatus.state === 'error' ? 'error' : 'hourglass_top'}
                      </span>
                      <div>
                        <strong style={{ fontSize: '14px' }}>{piaStatus.state === 'success' ? 'Connected' : piaStatus.state === 'error' ? 'Error' : 'Working...'}</strong>
                        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>{piaStatus.message}</p>
                        {piaStatus.lastGenerated && <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>Last generated: {new Date(piaStatus.lastGenerated).toLocaleString()}</p>}
                      </div>
                    </div>
                  )}

                  <h3 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="material-icons-round" style={{ color: 'var(--accent-primary)' }}>key</span>
                    PIA Account Credentials
                  </h3>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                    <div className="form-group">
                      <label>PIA Username (p-number)</label>
                      <input type="text" value={piaUsername} onChange={e => setPiaUsername(e.target.value)} className="text-input" placeholder="p1234567" />
                    </div>
                    <div className="form-group">
                      <label>PIA Password</label>
                      <input type="password" value={piaPassword} onChange={e => setPiaPassword(e.target.value)} className="text-input" placeholder="Your PIA password" />
                    </div>
                  </div>

                  <div className="form-group">
                    <label>PIA Region</label>
                    <select value={piaRegion} onChange={e => setPiaRegion(e.target.value)} className="select-input">
                      <option value="">Select a region...</option>
                      {piaRegions.length > 0 ? (
                        piaRegions.map(r => (
                          <option key={r.id} value={r.id}>
                            {r.name}{r.portForward ? ' ✓PF' : ''}
                          </option>
                        ))
                      ) : (
                        <>
                          <option value="us_california">US California</option>
                          <option value="us_chicago">US Chicago</option>
                          <option value="us_east">US East</option>
                          <option value="us_new_york_city">US New York</option>
                          <option value="ca_toronto">CA Toronto</option>
                          <option value="uk">UK London</option>
                          <option value="nl_amsterdam">Netherlands</option>
                          <option value="france">France</option>
                          <option value="sweden">SE Stockholm</option>
                          <option value="japan">JP Tokyo</option>
                        </>
                      )}
                    </select>
                    <button type="button" onClick={fetchPiaRegions} className="btn" style={{ marginTop: '8px', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.2)', color: 'var(--accent-primary)' }}>
                      <span className="material-icons-round" style={{ fontSize: '16px' }}>refresh</span>
                      Refresh Regions ({piaRegions.length} loaded)
                    </button>
                  </div>

                  <div className="toggle-switch-container" style={{ padding: '16px', background: 'rgba(0,0,0,0.2)', borderRadius: '12px' }}>
                    <div className="toggle-info">
                      <strong style={{ fontSize: '16px' }}>Enable Port Forwarding</strong>
                      <span style={{ color: 'var(--text-secondary)' }}>Only connect to PIA servers that support port forwarding</span>
                    </div>
                    <label className="switch">
                      <input type="checkbox" checked={piaPortForwarding} onChange={e => setPiaPortForwarding(e.target.checked)} />
                      <span className="slider"></span>
                    </label>
                  </div>

                  <button
                    type="button"
                    onClick={handlePiaGenerate}
                    disabled={piaGenerating || !piaUsername || !piaPassword || !piaRegion}
                    className="btn btn-primary"
                    style={{ width: '100%', padding: '16px', fontSize: '16px', marginTop: '8px' }}
                  >
                    <span className="material-icons-round">{piaGenerating ? 'hourglass_top' : 'bolt'}</span>
                    {piaGenerating ? 'Generating WireGuard Keys & Connecting...' : 'Generate Keys & Connect VPN'}
                  </button>

                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'center', marginTop: '4px' }}>
                    Generates a fresh WireGuard config, saves it, and restarts Gluetun. Credentials are stored for automatic background refresh.
                  </p>
                </>
              )}

              {/* PIA + OpenVPN */}
              {config.VPN_SERVICE_PROVIDER === 'private internet access' && config.VPN_TYPE === 'openvpn' && (
                <>
                  <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)', margin: '12px 0' }} />
                  <h3 style={{ fontSize: '18px', fontWeight: 600 }}>OpenVPN Configuration</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                    <div className="form-group">
                      <label>Username</label>
                      <input type="text" name="OPENVPN_USER" value={config.OPENVPN_USER || ''} onChange={handleChange} className="text-input" placeholder="PIA Username" />
                    </div>
                    <div className="form-group">
                      <label>Password</label>
                      <input type="password" name="OPENVPN_PASSWORD" value={config.OPENVPN_PASSWORD || ''} onChange={handleChange} className="text-input" placeholder="PIA Password" />
                    </div>
                  </div>
                </>
              )}

              {/* Non-PIA providers: Generic WireGuard and OpenVPN sections */}
              {config.VPN_SERVICE_PROVIDER !== 'private internet access' && (
                <>
                  <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)', margin: '12px 0' }} />
                  <h3 style={{ fontSize: '18px', fontWeight: 600 }}>WireGuard Configuration</h3>

                  <div className="form-group">
                    <label>Private Key</label>
                    <input type="password" name="WIREGUARD_PRIVATE_KEY" value={config.WIREGUARD_PRIVATE_KEY || ''} onChange={handleChange} className="text-input" placeholder="Base64 encoded private key" />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                    <div className="form-group">
                      <label>Client Addresses (Comma separated)</label>
                      <input type="text" name="WIREGUARD_ADDRESSES" value={config.WIREGUARD_ADDRESSES || ''} onChange={handleChange} className="text-input" placeholder="10.64.22.1/32" />
                    </div>
                    <div className="form-group">
                      <label>Custom MTU</label>
                      <input type="number" name="WIREGUARD_MTU" value={config.WIREGUARD_MTU || ''} onChange={handleChange} className="text-input" placeholder="1420" />
                    </div>
                  </div>

                  <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)', margin: '12px 0' }} />
                  <h3 style={{ fontSize: '18px', fontWeight: 600 }}>OpenVPN Configuration</h3>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                    <div className="form-group">
                      <label>Username</label>
                      <input type="text" name="OPENVPN_USER" value={config.OPENVPN_USER || ''} onChange={handleChange} className="text-input" placeholder="Provider Username" />
                    </div>
                    <div className="form-group">
                      <label>Password</label>
                      <input type="password" name="OPENVPN_PASSWORD" value={config.OPENVPN_PASSWORD || ''} onChange={handleChange} className="text-input" placeholder="Provider Password" />
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {activeTab === 'dns' && (
            <>
              <h3 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="material-icons-round" style={{ color: 'var(--accent-primary)' }}>dns</span>
                DNS over TLS (DoT)
              </h3>

              <div className="form-group">
                <label>DoT Providers (comma separated)</label>
                <input type="text" name="DOT_PROVIDERS" value={config.DOT_PROVIDERS || 'cloudflare'} onChange={handleChange} className="text-input" placeholder="cloudflare, quad9" />
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '8px' }}>
                  Available: cloudflare, quad9, google, mullvad, nextdns...
                </p>
              </div>

              <div className="form-group">
                <label>Custom Built-in DNS Servers</label>
                <input type="text" name="DNS_ADDRESS" value={config.DNS_ADDRESS || ''} onChange={handleChange} className="text-input" placeholder="127.0.0.1" />
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)', margin: '12px 0' }} />
              <h3 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="material-icons-round" style={{ color: 'var(--danger)' }}>gpp_bad</span>
                Blocklists System
              </h3>

              <div className="toggle-switch-container">
                <div className="toggle-info">
                  <strong style={{ fontSize: '15px' }}>Enable Malicious Blocking</strong>
                  <span>Block malicious hostnames automatically</span>
                </div>
                <label className="switch">
                  <input type="checkbox" name="BLOCK_MALICIOUS" checked={config.BLOCK_MALICIOUS !== 'off'} onChange={handleChange} />
                  <span className="slider"></span>
                </label>
              </div>

              <div className="toggle-switch-container">
                <div className="toggle-info">
                  <strong style={{ fontSize: '15px' }}>Block Surveillance</strong>
                  <span>Block surveillance and tracking requests</span>
                </div>
                <label className="switch">
                  <input type="checkbox" name="BLOCK_SURVEILLANCE" checked={config.BLOCK_SURVEILLANCE === 'on'} onChange={handleChange} />
                  <span className="slider"></span>
                </label>
              </div>

              <div className="toggle-switch-container">
                <div className="toggle-info">
                  <strong style={{ fontSize: '15px' }}>Block Ads</strong>
                  <span>Block well-known advertising networks</span>
                </div>
                <label className="switch">
                  <input type="checkbox" name="BLOCK_ADS" checked={config.BLOCK_ADS === 'on'} onChange={handleChange} />
                  <span className="slider"></span>
                </label>
              </div>
            </>
          )}

          {activeTab === 'network' && (
            <>
              <h3 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', marginTop: 0 }}>
                <span className="material-icons-round" style={{ color: 'var(--accent-primary)' }}>security</span>
                Firewall & Kill Switch
              </h3>

              <div className="toggle-switch-container" style={{ padding: '16px', background: 'rgba(0,0,0,0.2)', borderRadius: '12px' }}>
                <div className="toggle-info">
                  <strong style={{ fontSize: '16px' }}>Enable VPN Kill Switch</strong>
                  <span style={{ color: 'var(--text-secondary)' }}>Blocks all traffic if the VPN connection drops (Recommended)</span>
                </div>
                <label className="switch">
                  <input type="checkbox" name="FIREWALL" checked={config.FIREWALL !== 'off'} onChange={handleChange} />
                  <span className="slider"></span>
                </label>
              </div>

              <div className="form-group">
                <label>Allow Local Network Access (Outbound Subnets)</label>
                <input type="text" name="FIREWALL_OUTBOUND_SUBNETS" value={config.FIREWALL_OUTBOUND_SUBNETS || ''} onChange={handleChange} className="text-input" placeholder="e.g. 192.168.1.0/24, 10.0.0.0/8" />
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '8px' }}>
                  Required to access web GUIs and local services while the kill switch is active.
                </p>
              </div>

              <div className="form-group">
                <label>Allow VPN Input Ports (Advanced)</label>
                <input type="text" name="FIREWALL_VPN_INPUT_PORTS" value={config.FIREWALL_VPN_INPUT_PORTS || ''} onChange={handleChange} className="text-input" placeholder="e.g. 80, 443" />
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '8px' }}>
                  Open specific ports on the VPN side for incoming connections.
                </p>
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)', margin: '16px 0' }} />

              <h3 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="material-icons-round" style={{ color: 'var(--accent-primary)' }}>hub</span>
                Port Forwarding
              </h3>

              <div style={{ padding: '16px', borderRadius: '8px', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid var(--glass-highlight)', marginBottom: '12px' }}>
                <p style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                  <span className="material-icons-round" style={{ color: 'var(--accent-primary)' }}>info</span>
                  Port forwarding is dynamically mapped inside the Gluetun container. Supported via PIA, ProtonVPN, Perfect Privacy.
                </p>
              </div>

              <div className="toggle-switch-container" style={{ padding: '16px', background: 'rgba(0,0,0,0.2)', borderRadius: '12px' }}>
                <div className="toggle-info">
                  <strong style={{ fontSize: '16px' }}>Enable Global Port Forwarding</strong>
                  <span style={{ color: 'var(--text-secondary)' }}>Automatically request and maintain an open port on the VPN server</span>
                </div>
                <label className="switch">
                  <input type="checkbox" name="VPN_PORT_FORWARDING" checked={config.VPN_PORT_FORWARDING === 'on'} onChange={handleChange} />
                  <span className="slider"></span>
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginTop: '16px' }}>
                <div className="form-group">
                  <label>Port Forwarding Provider Override</label>
                  <select name="VPN_PORT_FORWARDING_PROVIDER" value={config.VPN_PORT_FORWARDING_PROVIDER || ''} onChange={handleChange} className="select-input">
                    <option value="">Default (same as VPN provider)</option>
                    <option value="pia">Private Internet Access</option>
                    <option value="protonvpn">ProtonVPN</option>
                    <option value="perfect privacy">Perfect Privacy</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>Currently Assigned Port</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px', background: 'rgba(0,0,0,0.3)', borderRadius: '10px', border: '1px dashed var(--glass-border)' }}>
                  <span className="material-icons-round" style={{ color: 'var(--success)' }}>vpn_lock</span>
                  <span style={{ fontSize: '24px', fontWeight: '700', fontFamily: 'monospace', color: 'var(--success)' }}>
                    {config.VPN_PORT_FORWARDING === 'on' ? 'Waiting for lease...' : 'Disabled'}
                  </span>
                </div>
              </div>
            </>
          )}

          {activeTab === 'proxies' && (
            <>
              <div style={{ padding: '16px', borderRadius: '8px', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid var(--glass-highlight)', marginBottom: '12px' }}>
                <p style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                  <span className="material-icons-round" style={{ color: 'var(--accent-primary)' }}>info</span>
                  Built-in proxy servers allow devices on your LAN to privately route traffic through the VPN without complex network-level routing.
                </p>
              </div>

              <h3 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px' }}>
                <span className="material-icons-round" style={{ color: 'var(--accent-primary)' }}>vpn_lock</span>
                Shadowsocks Proxy
              </h3>

              <div className="toggle-switch-container" style={{ padding: '16px', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', marginBottom: '16px' }}>
                <div className="toggle-info">
                  <strong style={{ fontSize: '16px' }}>Enable Shadowsocks Server</strong>
                  <span style={{ color: 'var(--text-secondary)' }}>Runs a lightweight, undetectable proxy on port 8388</span>
                </div>
                <label className="switch">
                  <input type="checkbox" name="SHADOWSOCKS" checked={config.SHADOWSOCKS === 'on'} onChange={handleChange} />
                  <span className="slider"></span>
                </label>
              </div>

              <div className="form-group">
                <label>Shadowsocks Password</label>
                <input type="password" name="SHADOWSOCKS_PASSWORD" value={config.SHADOWSOCKS_PASSWORD || ''} onChange={handleChange} className="text-input" placeholder="Super Secure Password" />
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)', margin: '16px 0' }} />

              <h3 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="material-icons-round" style={{ color: 'var(--accent-primary)' }}>public</span>
                HTTP Proxy
              </h3>

              <div className="toggle-switch-container" style={{ padding: '16px', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', marginBottom: '16px' }}>
                <div className="toggle-info">
                  <strong style={{ fontSize: '16px' }}>Enable HTTP Proxy Server</strong>
                  <span style={{ color: 'var(--text-secondary)' }}>Runs a standard HTTP proxy on port 8888</span>
                </div>
                <label className="switch">
                  <input type="checkbox" name="HTTPPROXY" checked={config.HTTPPROXY === 'on'} onChange={handleChange} />
                  <span className="slider"></span>
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                <div className="form-group">
                  <label>HTTP Proxy Username (Optional)</label>
                  <input type="text" name="HTTPPROXY_USER" value={config.HTTPPROXY_USER || ''} onChange={handleChange} className="text-input" placeholder="Proxy Username" />
                </div>
                <div className="form-group">
                  <label>HTTP Proxy Password (Optional)</label>
                  <input type="password" name="HTTPPROXY_PASSWORD" value={config.HTTPPROXY_PASSWORD || ''} onChange={handleChange} className="text-input" placeholder="Proxy Password" />
                </div>
              </div>
            </>
          )}


        </form>
      </div>
    </div>
  );
}
