import requests

# Set your file path here
file_path = "C:/Projects/Neon AI Project/Neon-AI-Project/multi_llm_chatbot_backend/app/tests/Resume.pdf"

# Step 1: Upload the file
upload_url = "http://localhost:8000/upload-document"
with open(file_path, "rb") as file:
    files = {"file": ("Resume.pdf", file, "application/pdf")}
    #print("Received file type:", file.content_type)
    upload_response = requests.post(upload_url, files=files)

print("Upload Status:", upload_response.status_code)
print("Upload Response:", upload_response.json())

# Step 2: Fetch context
context_url = "http://localhost:8000/context"
context_response = requests.get(context_url)

print("\nSession Context Status:", context_response.status_code)
print("Latest Context Snippet:")
for msg in context_response.json()[-3:]:  # Show last 3 entries
    print(msg)
