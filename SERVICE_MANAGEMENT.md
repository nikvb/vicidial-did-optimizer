# DID Optimizer API - Service Management Guide

## Service Overview

The DID Optimizer API is now running as a **systemd service** with automatic restart and monitoring capabilities.

**Service Name:** `did-api.service`
**Port:** 5000
**User:** root
**Working Directory:** `/home/na/didapi`

---

## Service Management Commands

### Basic Operations
```bash
# Start the service
sudo systemctl start did-api.service

# Stop the service
sudo systemctl stop did-api.service

# Restart the service
sudo systemctl restart did-api.service

# Check service status
sudo systemctl status did-api.service

# View full status (no paging)
sudo systemctl status did-api.service --no-pager
```

### Enable/Disable Auto-Start
```bash
# Enable service to start on boot (already enabled)
sudo systemctl enable did-api.service

# Disable auto-start on boot
sudo systemctl disable did-api.service

# Check if enabled
systemctl is-enabled did-api.service
```

---

## Monitoring & Logs

### Quick Monitoring Script
```bash
# Run comprehensive health check
/home/na/didapi/monitor-did-api.sh
```

### View Logs
```bash
# View output logs (last 50 lines)
sudo tail -50 /var/log/did-api/output.log

# View error logs
sudo tail -50 /var/log/did-api/error.log

# Follow logs in real-time
sudo tail -f /var/log/did-api/output.log

# View systemd journal logs
sudo journalctl -u did-api.service -f
sudo journalctl -u did-api.service --since "1 hour ago"
```

### Check Port Status
```bash
# Check if port 5000 is active
lsof -i :5000

# Check network connections
netstat -tlnp | grep 5000
```

---

## Auto-Restart Configuration

The service is configured with **automatic restart** on failure:

- **Restart Policy:** Always restart
- **Restart Delay:** 10 seconds after failure
- **Start Limit:** Max 3 restarts within 60 seconds
- **Stop Timeout:** 30 seconds graceful shutdown

### Test Auto-Restart
```bash
# Kill the process to test auto-restart
sudo pkill -9 -f "node.*server-full.js"

# Wait 12 seconds and check status
sleep 12 && sudo systemctl status did-api.service
```

---

## API Health Checks

### Manual Health Check
```bash
# Test DID endpoint
curl -s "http://api3.amdy.io:5000/api/v1/dids/next?campaign_id=TEST001&agent_id=101" \
  -H "x-api-key: did_315b95e7b2107598f4c5c6f51d21b3ac1768892fa81c1bb3ea38756bb1c2b43e"

# Check response code only
curl -s -o /dev/null -w "%{http_code}" "http://api3.amdy.io:5000/api/v1/dids/next?campaign_id=TEST001&agent_id=101" \
  -H "x-api-key: did_315b95e7b2107598f4c5c6f51d21b3ac1768892fa81c1bb3ea38756bb1c2b43e"
```

### Expected Response
```json
{
  "success": true,
  "did": {
    "number": "+13323456420",
    "location": {
      "country": "US",
      "source": "Unknown",
      "updatedAt": "2025-10-18T14:34:52.492Z"
    },
    "is_fallback": false
  },
  "metadata": {
    "campaign_id": "TEST001",
    "agent_id": "101",
    "timestamp": "2025-10-21T17:27:50.728Z"
  }
}
```

---

## Resource Limits

The service is configured with the following limits:

- **Memory Limit:** 1GB (MemoryLimit=1G)
- **File Descriptors:** 65,536 (LimitNOFILE=65536)
- **Private Temp:** Enabled for security
- **Stop Timeout:** 30 seconds

### Check Resource Usage
```bash
# View memory and CPU usage
systemctl status did-api.service

# View detailed resource usage
systemd-cgtop -m

# Check process details
ps aux | grep "server-full.js"
```

---

## Troubleshooting

### Service Won't Start
```bash
# Check detailed status
sudo systemctl status did-api.service -l

# View recent journal logs
sudo journalctl -u did-api.service -n 50

# Check if MongoDB is running
sudo systemctl status mongod.service

# Verify .env file exists
cat /home/na/didapi/.env | grep PORT
```

### Service Keeps Restarting
```bash
# Check error logs
sudo tail -100 /var/log/did-api/error.log

# Check if port is already in use
lsof -i :5000

# View systemd restart history
sudo journalctl -u did-api.service | grep "Started DID"
```

### Port Already in Use
```bash
# Find process using port 5000
lsof -i :5000

# Kill the process (if needed)
sudo kill -9 <PID>

# Or kill by name
sudo pkill -9 -f "node.*server-full.js"
```

### MongoDB Issues
```bash
# Check MongoDB status
sudo systemctl status mongod.service

# Start MongoDB
sudo systemctl start mongod.service

# Test MongoDB connection
mongosh --eval "db.adminCommand('ping')" --quiet
```

---

## Service Configuration File

**Location:** `/etc/systemd/system/did-api.service`

To modify the service:
```bash
# Edit service file
sudo nano /etc/systemd/system/did-api.service

# Reload systemd configuration
sudo systemctl daemon-reload

# Restart service
sudo systemctl restart did-api.service
```

---

## Environment Variables

The service loads environment variables from:
- **File:** `/home/na/didapi/.env`
- **Direct:** `NODE_ENV=production` and `PORT=5000` (set in service file)

### Update Environment
```bash
# Edit .env file
nano /home/na/didapi/.env

# Restart service to apply changes
sudo systemctl restart did-api.service
```

---

## Automated Monitoring Setup (Optional)

### Cron Job for Health Checks
```bash
# Edit crontab
crontab -e

# Add monitoring every 5 minutes
*/5 * * * * /home/na/didapi/monitor-did-api.sh >> /var/log/did-api/monitor.log 2>&1
```

### Email Alerts on Failure (Advanced)
Add to service file under `[Service]`:
```ini
OnFailure=status-email@%n.service
```

---

## Quick Reference

| Task | Command |
|------|---------|
| **Check status** | `sudo systemctl status did-api.service` |
| **Restart** | `sudo systemctl restart did-api.service` |
| **View logs** | `sudo tail -f /var/log/did-api/output.log` |
| **Monitor** | `/home/na/didapi/monitor-did-api.sh` |
| **Test API** | `curl "http://api3.amdy.io:5000/api/v1/dids/next?campaign_id=TEST&agent_id=1" -H "x-api-key: did_315b95e7b2107598f4c5c6f51d21b3ac1768892fa81c1bb3ea38756bb1c2b43e"` |

---

## Notes

- ✅ Service is **enabled** and will start automatically on system boot
- ✅ Auto-restart configured with 10-second delay
- ✅ MongoDB dependency configured (starts after MongoDB)
- ✅ Logs stored in `/var/log/did-api/`
- ✅ Production mode enabled
- ✅ Memory limited to 1GB for stability

---

**Last Updated:** 2025-10-21
**Service Version:** 1.0
**Maintained By:** DID Optimizer Team
