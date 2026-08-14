#!/bin/bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4YzQ3ZGQ3MGVjNmY1MzIzY2U2MTgxOSIsImVtYWlsIjoiY2xpZW50QHRlc3QzLmNvbSIsImZpcnN0TmFtZSI6InRlc3QxIiwibGFzdE5hbWUiOiJ0ZXN0Iiwicm9sZSI6IkNMSUVOVCIsImlhdCI6MTc2OTMxMzM5MCwiZXhwIjoxNzY5OTE4MTkwfQ.xHqm9RzuQBwg_dmeomP5G1M09xdQIizQaH3CQZTEBoA"
curl -s "http://localhost:5000/api/v1/analytics/capacity" \
  -H "Authorization: Bearer $TOKEN" \
  | head -500
