import json
import re

content = '''{
    "userReports": null,
    "reputationStatus": "Positive",
    "totalCalls": 0,
    "lastCallDate": null,
    "robokillerStatus": "Allowed",
    "spamScore": null,
    "callerName": null,
    "location": null,
    "carrier": null,
    "commentsCount": null
}'''

# Test direct JSON parsing
try:
    parsed = json.loads(content)
    print("Direct parse SUCCESS:", parsed)
except json.JSONDecodeError as e:
    print("Direct parse FAILED:", e)

# Test regex pattern matching
json_match = re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', content, re.DOTALL)
if json_match:
    try:
        parsed = json.loads(json_match.group(0))
        print("Regex parse SUCCESS:", parsed)
    except json.JSONDecodeError as e:
        print("Regex parse FAILED:", e)
else:
    print("Regex NO MATCH")
