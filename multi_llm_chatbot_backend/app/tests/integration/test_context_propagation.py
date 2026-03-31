import requests
import time

BASE_URL = "http://localhost:8000"

def test_unified_chat():
    print("\nSending unified chat request to /chat...\n")
    payload = {
        "user_input": "I'm a second year PhD student in Machine Learning. Any advice for my research paper presentation? I am preparing for final QnA session."
    }

    try:
        response = requests.post(f"{BASE_URL}/chat", json=payload)
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        print("Error:", e)
        return

    data = response.json()
    print(f"Type: {data.get('type')}")
    print(f"Collected Info: {data.get('collected_info')}")

    for reply in data.get("responses", []):
        print(f"\n{reply['persona']}:\n{reply['response'][:500]}...\n")  # show only first 500 chars

def test_context_log():
    print("\nFetching /context...\n")
    try:
        response = requests.get(f"{BASE_URL}/context")
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        print("Error fetching context:", e)
        return

    context = response.json()
    for entry in context[-6:]:  # Show the last 6 interactions for relevance
        print(f"{entry['role']}: {entry['content'][:120]}...")  # preview each entry

if __name__ == "__main__":
    test_unified_chat()
    time.sleep(2)
    test_context_log()
