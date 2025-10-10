# Server Logging Guide

## Current Server Logs

The server outputs debug logs to **stdout/stderr**. Here are different ways to view the logs:

### 1. View Current Running Server Logs

If the server is running in the background, you can view its output:

```bash
# If started with the background command
# The logs are currently in the terminal session
# Check process output with:
ps aux | grep "node server-full.js"
```

### 2. Start Server with Log File (Recommended)

Use the provided start script to automatically save logs to a file:

```bash
# Start server with logging
./start-server.sh

# View logs in real-time
tail -f logs/server-$(date +%Y%m%d).log

# View all logs for today
cat logs/server-$(date +%Y%m%d).log

# Search logs for specific errors
grep "ERROR" logs/server-*.log
grep "Dashboard stats" logs/server-*.log
```

### 3. Using PM2 (Production - Best Option)

PM2 provides automatic log rotation and management:

```bash
# Install PM2 globally (if not already installed)
npm install -g pm2

# Start server with PM2
pm2 start ecosystem.config.cjs

# View logs in real-time
pm2 logs did-optimizer

# View only error logs
pm2 logs did-optimizer --err

# View only output logs
pm2 logs did-optimizer --out

# Clear old logs
pm2 flush did-optimizer

# Save PM2 configuration to start on boot
pm2 save
pm2 startup
```

**PM2 Log Files:**
- Error logs: `/home/na/didapi/logs/error.log`
- Output logs: `/home/na/didapi/logs/output.log`
- Combined logs: `/home/na/didapi/logs/combined.log`

### 4. Direct Node Execution with Logging

```bash
# Redirect all output to a log file
PORT=5000 node server-full.js > logs/server.log 2>&1 &

# Or separate stdout and stderr
PORT=5000 node server-full.js > logs/output.log 2> logs/error.log &

# View logs
tail -f logs/server.log
```

## Log Types in the Application

The server outputs several types of debug messages:

- `🔍` - Debug information
- `✅` - Success messages
- `❌` - Errors
- `⚠️` - Warnings
- `📊` - Statistics/metrics
- `👤` - User/authentication info
- `🎯` - VICIdial DID rotation logs
- `🔄` - Rotation algorithm details

## Example Log Entries

```
🔍 Dashboard stats endpoint called
👤 User role: CLIENT Tenant: 68c47dd70ec6f5323ce61817
📊 DID Query filter: { tenantId: '68c47dd70ec6f5323ce61817' }
✅ Dashboard stats response ready
```

## Log Rotation

When using PM2, logs are automatically managed. For manual logging:

```bash
# Create a simple log rotation script
cat > rotate-logs.sh << 'EOF'
#!/bin/bash
cd /home/na/didapi/logs
find . -name "server-*.log" -mtime +30 -delete
gzip server-$(date -d "yesterday" +%Y%m%d).log 2>/dev/null
EOF

chmod +x rotate-logs.sh

# Add to crontab to run daily at midnight
# crontab -e
# Add: 0 0 * * * /home/na/didapi/rotate-logs.sh
```

## Monitoring Production Logs

```bash
# Monitor all activity
pm2 monit

# Check server status
pm2 status

# View logs from the last hour
pm2 logs did-optimizer --lines 1000

# Filter logs
pm2 logs did-optimizer | grep "Dashboard"
pm2 logs did-optimizer | grep "ERROR"
```

## Current Server Status

Check if server is running:
```bash
lsof -i :5000
ps aux | grep "node server-full.js"
```

## Troubleshooting

If you don't see logs:

1. **Check if server is running:** `lsof -i :5000`
2. **Check permissions:** `ls -la logs/`
3. **Manually create log file:** `touch logs/server.log && chmod 666 logs/server.log`
4. **Use PM2 for automatic handling:** `pm2 start ecosystem.config.cjs`
