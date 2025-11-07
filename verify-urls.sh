#!/bin/bash
echo "🔍 Verifying URL Configuration..."
echo ""
echo "Backend .env:"
grep -E "FRONTEND_URL|API_BASE_URL|GOOGLE_CALLBACK_URL" /home/na/didapi/.env
echo ""
echo "Frontend .env:"
cat /home/na/didapi/temp_clone/frontend/.env
echo ""
echo "Checking for any remaining api3.amdy.io URLs in source files:"
RESULTS=$(grep -r "api3.amdy.io" /home/na/didapi/{.env,server-full.js,temp_clone/frontend/src/{pages,components}} 2>/dev/null | grep -v "node_modules" | grep -v ".git" | grep -v "test-" | grep -v ".cjs")
if [ -z "$RESULTS" ]; then
  echo "✅ No hardcoded api3.amdy.io URLs found in production files!"
else
  echo "⚠️  Found hardcoded URLs:"
  echo "$RESULTS"
fi
echo ""
echo "Frontend build files:"
ls -lh /home/na/didapi/frontend/static/js/main.*.js | tail -1
