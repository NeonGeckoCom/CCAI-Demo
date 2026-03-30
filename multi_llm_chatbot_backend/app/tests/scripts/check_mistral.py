import requests

url = "http://localhost:11434/api/generate"

payload = {
    "model": "mistral",
    "prompt": "You are a professor. Give me PhD advice.",
    "stream": False
}

response = requests.post(url, json=payload)
print(response.status_code)
print(response.json())