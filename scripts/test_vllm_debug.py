#!/usr/bin/env python3
import requests
import json
import os

api_base = "http://71.241.245.11:41924/v1"
model = "openai/gpt-oss-20b"

prompt = """Extract reputation data from RoboKiller page text for 7193000078.

TEXT:
(719) 300-0078 - RoboKiller Lookup Mobile App... Positive User reputation Allowed Robokiller status Analytics August 28, 2025 Last call 11 Total calls 0 User reports

Return ONLY this JSON (no other text):
{
    "userReports": <number or null>,
    "reputationStatus": "Positive|Negative|Neutral|Unknown",
    "totalCalls": <number or null>,
    "lastCallDate": "date or null",
    "robokillerStatus": "Allowed|Blocked|Unknown",
    "spamScore": <0-100 or null>,
    "callerName": "string or null",
    "location": "string or null",
    "carrier": "string or null",
    "commentsCount": <number or null>
}

Find: User reputation (Positive/Negative/Neutral), Robokiller status (Allowed/Blocked), Total calls, User reports, Last call date."""

headers = {
    "Authorization": "Bearer not-needed",
    "Content-Type": "application/json"
}

payload = {
    "model": model,
    "messages": [{"role": "user", "content": prompt}],
    "temperature": 0.1,
    "max_tokens": 600
}

response = requests.post(f"{api_base}/chat/completions", headers=headers, json=payload)
data = response.json()

print("Content:", data['choices'][0]['message'].get('content'))
print("\nReasoning:", data['choices'][0]['message'].get('reasoning_content', '')[:500])
