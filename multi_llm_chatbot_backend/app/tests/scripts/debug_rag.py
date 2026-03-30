#!/usr/bin/env python3
"""
Debug RAG Chat Integration

This script helps debug why RAG isn't working in chat responses.
"""

import requests
import json
import time

BASE_URL = "http://localhost:8000"

def test_direct_search():
    """Test direct document search with detailed output"""
    print("🔍 Testing direct document search...")
    
    test_queries = [
        {"query": "research methodology approach", "persona": "methodologist"},
        {"query": "theoretical framework theory", "persona": "theorist"},
        {"query": "practical steps implementation", "persona": "pragmatist"}
    ]
    
    for test in test_queries:
        print(f"\nTesting: '{test['query']}' for {test['persona']}")
        
        try:
            response = requests.post(
                f"{BASE_URL}/search-documents",
                json=test,
                timeout=10
            )
            
            if response.status_code == 200:
                result = response.json()
                print(f"✅ Found {result['results_count']} results")
                
                for i, chunk in enumerate(result['results'], 1):
                    score = chunk['relevance_score']
                    distance = chunk.get('distance', 'unknown')
                    text_preview = chunk['text'][:100]
                    
                    print(f"  Result {i}:")
                    print(f"    Relevance: {score:.4f}")
                    print(f"    Distance: {distance}")
                    print(f"    Text: {text_preview}...")
                    print(f"    Meets 0.1 threshold: {'✅' if score > 0.1 else '❌'}")
            else:
                print(f"❌ Search failed: {response.status_code}")
                
        except Exception as e:
            print(f"❌ Search error: {e}")

def test_single_persona_chat():
    """Test individual persona chat to isolate issues"""
    print("\n💬 Testing individual persona chat...")
    
    personas = ["methodologist", "theorist", "pragmatist"]
    query = "What research methodology should I use based on the uploaded document?"
    
    for persona in personas:
        print(f"\nTesting {persona}...")
        
        try:
            # Note: This endpoint might not exist yet, but we can try
            response = requests.post(
                f"{BASE_URL}/chat/{persona}",
                json={"user_input": query, "response_length": "short"},
                timeout=15
            )
            
            if response.status_code == 200:
                result = response.json()
                print(f"✅ {persona} response received")
                
                if 'rag_info' in result:
                    rag_info = result['rag_info']
                    print(f"   Used documents: {rag_info.get('used_documents', False)}")
                    print(f"   Chunks used: {rag_info.get('document_chunks_used', 0)}")
                
                if 'persona' in result:
                    response_text = result['persona'].get('response', '')[:150]
                    print(f"   Response: {response_text}...")
            else:
                print(f"❌ {persona} chat failed: {response.status_code}")
                
        except Exception as e:
            print(f"❌ {persona} chat error: {e}")

def test_sequential_chat_debug():
    """Test sequential chat with more detailed debugging"""
    print("\n🔄 Testing sequential chat with debug info...")
    
    query = "Based on the methodology document I uploaded, what approach should I take?"
    
    try:
        response = requests.post(
            f"{BASE_URL}/chat-sequential",
            json={"user_input": query, "response_length": "short"},
            timeout=30
        )
        
        if response.status_code == 200:
            result = response.json()
            print(f"✅ Sequential chat response received")
            print(f"   Response type: {result.get('type')}")
            
            if 'rag_info' in result:
                rag_info = result['rag_info']
                print(f"   RAG enabled: {rag_info.get('rag_enabled', False)}")
                print(f"   Personas using documents: {rag_info.get('personas_using_documents', 0)}")
                print(f"   Total chunks used: {rag_info.get('total_document_chunks_used', 0)}")
            
            if 'responses' in result:
                print(f"\n   Individual persona results:")
                for resp in result['responses']:
                    persona_name = resp.get('persona_name', 'Unknown')
                    used_docs = resp.get('used_documents', False)
                    chunks_used = resp.get('document_chunks_used', 0)
                    error = resp.get('error', False)
                    
                    print(f"   {persona_name}:")
                    print(f"     Used documents: {used_docs}")
                    print(f"     Chunks used: {chunks_used}")
                    print(f"     Error: {error}")
                    
                    if resp.get('response'):
                        response_preview = resp['response'][:100]
                        print(f"     Response: {response_preview}...")
        else:
            print(f"❌ Sequential chat failed: {response.status_code}")
            print(f"   Response: {response.text}")
            
    except Exception as e:
        print(f"❌ Sequential chat error: {e}")

def upload_better_test_document():
    """Upload a more targeted test document"""
    print("\n📄 Uploading better test document...")
    
    better_doc = """
    PhD Research Methodology Guide for Machine Learning
    
    METHODOLOGY SECTION:
    For machine learning research, you should use a mixed-methods approach combining quantitative experiments with qualitative analysis. Start with baseline models and incrementally add complexity. Use proper train/validation/test splits with stratified sampling. Statistical significance testing is crucial for methodology validation.
    
    THEORETICAL FRAMEWORK SECTION:
    Ground your work in established learning theory and computational complexity theory. Consider information theory principles and statistical learning theory. The epistemological assumptions should assume that knowledge can be extracted from data through systematic analysis. Review relevant literature and position your work within existing theoretical frameworks.
    
    PRACTICAL IMPLEMENTATION SECTION:
    Your next steps should include: 1) Define clear research questions, 2) Design data collection methods, 3) Implement baseline models, 4) Conduct hyperparameter tuning, 5) Perform comprehensive evaluation, 6) Document all results. Create a timeline with specific milestones and success metrics for each phase.
    """
    
    try:
        with open("better_test_doc.txt", "w") as f:
            f.write(better_doc)
        
        with open("better_test_doc.txt", "rb") as f:
            files = {"file": ("ml_methodology_guide.txt", f, "text/plain")}
            response = requests.post(f"{BASE_URL}/upload-document", files=files)
        
        import os
        os.remove("better_test_doc.txt")
        
        if response.status_code == 200:
            result = response.json()
            print(f"✅ Better document uploaded: {result['chunks_created']} chunks")
            return True
        else:
            print(f"❌ Upload failed: {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ Upload error: {e}")
        return False

def main():
    """Run debug sequence"""
    print("🔧 RAG Chat Debug Tool")
    print("=" * 40)
    
    # Test 1: Upload better document
    if not upload_better_test_document():
        print("❌ Document upload failed, continuing with existing document...")
    
    # Test 2: Direct search
    test_direct_search()
    
    # Test 3: Individual persona chat (if endpoint exists)
    test_single_persona_chat()
    
    # Test 4: Sequential chat with debug
    test_sequential_chat_debug()
    
    print("\n" + "=" * 40)
    print("🔍 Debug Analysis:")
    print("1. Check if direct search shows relevance scores > 0.1")
    print("2. Check if individual personas work (may not be implemented)")
    print("3. Check if sequential chat shows 'used_documents: true' for any persona")
    print("4. Look for server logs showing document retrieval attempts")
    
    print("\nIf RAG still isn't working:")
    print("- Check server logs for 'Retrieved X chunks for persona_name'")
    print("- Verify relevance scores are above 0.1 threshold")
    print("- Ensure document context is being passed to personas")

if __name__ == "__main__":
    main()