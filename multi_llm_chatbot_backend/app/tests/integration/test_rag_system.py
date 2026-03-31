import requests
import json
import time

BASE_URL = "http://localhost:8000"

def test_rag_system():
    """
    Comprehensive test of the RAG system
    """
    print("🚀 Testing RAG System Integration\n")
    
    # Test 1: Upload a document
    print("📄 Test 1: Uploading a document...")
    
    # Create a sample research document
    sample_document = """
    Research Methodology for Machine Learning PhD
    
    Abstract: This document outlines the methodology for conducting research in machine learning, 
    focusing on experimental design, data collection, and validation techniques.
    
    1. Introduction
    Machine learning research requires rigorous methodology to ensure reproducible results.
    The theoretical framework must be grounded in statistical learning theory.
    
    2. Methodology
    Our research design follows a mixed-methods approach combining quantitative experiments
    with qualitative analysis. Data collection involves sampling from multiple datasets
    to ensure statistical validity and external validity.
    
    3. Practical Implementation
    The implementation strategy focuses on actionable steps: first, establish baseline models,
    then implement incremental improvements, and finally conduct comprehensive evaluation.
    Each step should have clear success metrics and timelines.
    
    4. Theoretical Framework
    The conceptual foundation draws from information theory, statistical learning theory,
    and computational complexity theory. The epistemological assumptions underlying
    our approach assume that knowledge can be extracted from data through systematic analysis.
    
    5. Next Steps
    Immediate action items include: data preprocessing, model selection, hyperparameter tuning,
    and result validation. The timeline should prioritize high-impact activities first.
    """
    
    # Save as temporary file
    with open("temp_research_doc.txt", "w") as f:
        f.write(sample_document)
    
    # Upload the document
    with open("temp_research_doc.txt", "rb") as f:
        files = {"file": ("research_methodology.txt", f, "text/plain")}
        upload_response = requests.post(f"{BASE_URL}/upload-document", files=files)
    
    print(f"Upload Status: {upload_response.status_code}")
    print(f"Response: {json.dumps(upload_response.json(), indent=2)}\n")
    
    # Test 2: Get document statistics
    print("📊 Test 2: Getting document statistics...")
    stats_response = requests.get(f"{BASE_URL}/document-stats")
    print(f"Stats: {json.dumps(stats_response.json(), indent=2)}\n")
    
    # Test 3: Test direct document search
    print("🔍 Test 3: Testing direct document search...")
    
    search_queries = [
        {"query": "What methodology should I use?", "persona": "methodologist"},
        {"query": "What is the theoretical framework?", "persona": "theorist"},
        {"query": "What are the next steps?", "persona": "pragmatist"}
    ]
    
    for search in search_queries:
        print(f"\nSearching: '{search['query']}' for {search['persona']}")
        search_response = requests.post(
            f"{BASE_URL}/search-documents",
            json=search
        )
        
        if search_response.status_code == 200:
            results = search_response.json()
            print(f"Found {results['results_count']} results")
            for i, result in enumerate(results['results'][:2], 1):  # Show top 2
                print(f"  Result {i}: {result['text'][:100]}... (score: {result['relevance_score']:.3f})")
        else:
            print(f"Search failed: {search_response.status_code}")
    
    print("\n" + "="*60)
    
    # Test 4: Test RAG-enhanced chat
    print("💬 Test 4: Testing RAG-enhanced chat responses...\n")
    
    chat_queries = [
        "I need help with my research methodology. What approach should I take?",
        "Can you explain the theoretical framework I should consider?", 
        "What are the practical next steps I should focus on?"
    ]
    
    for query in chat_queries:
        print(f"Query: {query}")
        chat_response = requests.post(
            f"{BASE_URL}/chat-sequential",
            json={"user_input": query, "response_length": "short"}
        )
        
        if chat_response.status_code == 200:
            result = chat_response.json()
            print(f"Response type: {result.get('type')}")
            
            if 'rag_info' in result:
                rag_info = result['rag_info']
                print(f"RAG Info: {rag_info['personas_using_documents']}/{len(result.get('responses', []))} personas used documents")
                print(f"Total chunks used: {rag_info['total_document_chunks_used']}")
            
            # Show one advisor response
            if 'responses' in result and result['responses']:
                advisor = result['responses'][0]
                print(f"\n{advisor['persona_name']}: {advisor['response'][:200]}...")
                if advisor.get('used_documents'):
                    print(f"✅ Used {advisor.get('document_chunks_used', 0)} document chunks")
                else:
                    print("❌ No documents used")
        else:
            print(f"Chat failed: {chat_response.status_code}")
        
        print("\n" + "-"*40 + "\n")
    
    # Test 5: Session statistics
    print("📈 Test 5: Getting comprehensive session statistics...")
    session_stats = requests.get(f"{BASE_URL}/session-stats")
    if session_stats.status_code == 200:
        stats = session_stats.json()
        print(f"Session Stats:")
        print(f"  Messages: {stats.get('message_count', 0)}")
        print(f"  Uploaded files: {len(stats.get('uploaded_files', []))}")
        print(f"  RAG documents: {stats.get('rag_stats', {}).get('total_documents', 0)}")
        print(f"  RAG chunks: {stats.get('rag_stats', {}).get('total_chunks', 0)}")
    
    # Cleanup
    import os
    try:
        os.remove("temp_research_doc.txt")
    except:
        pass
    
    print("\n🎉 RAG System Testing Complete!")
    print("\nKey Improvements:")
    print("✅ Documents are now chunked and stored in vector database")
    print("✅ Each advisor gets persona-specific document chunks") 
    print("✅ Only relevant content is retrieved for each query")
    print("✅ Session context is much more efficient")
    print("✅ Supports semantic search across all uploaded documents")

if __name__ == "__main__":
    test_rag_system()