"""Test script for symbol indexer and context agent integration"""
import asyncio
import sys
from pathlib import Path

# Add parent directory to path so we can import app modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services.symbol_indexer import SymbolIndexer, get_indexer
from app.agents.context_agent import get_context, search_project_symbols

PROJECT_ROOT = r"c:\dev\work\Senorita2\backend"
TEST_FILE = r"c:\dev\work\Senorita2\backend\app\agents\orchestrator.py"


async def test_symbol_indexer():
    print("=" * 60)
    print("Testing Symbol Indexer")
    print("=" * 60)
    
    indexer = SymbolIndexer()
    count = indexer.index_project(PROJECT_ROOT)
    print(f"Indexed {count} files")
    
    summary = indexer.get_project_summary()
    print(f"Total symbols: {summary['total_symbols']}")
    print(f"By kind: {summary['by_kind']}")
    print()
    
    # Test search
    print("Search for 'orchestrat':")
    results = indexer.search_symbols("orchestrat", limit=5)
    for sym in results:
        print(f"  - {sym.kind}: {sym.name} @ {sym.file_path}:{sym.line}")
    print()
    
    # Test search for 'agent'
    print("Search for 'agent':")
    results = indexer.search_symbols("agent", limit=5)
    for sym in results:
        print(f"  - {sym.kind}: {sym.name} @ {sym.file_path}:{sym.line}")
    print()


async def test_context_agent():
    print("=" * 60)
    print("Testing Context Agent with Symbol Indexing")
    print("=" * 60)
    
    ctx = await get_context(
        file_path=TEST_FILE,
        cursor_line=175,  # coding_node function
        project_root=PROJECT_ROOT,
    )
    
    print(f"File: {ctx['file_path']}")
    print(f"Language: {ctx['language']}")
    print(f"Symbols in file: {len(ctx.get('symbols_in_file', []))}")
    print(f"Related symbols: {len(ctx.get('related_symbols', []))}")
    print()
    
    if ctx.get('symbol_at_cursor'):
        sym = ctx['symbol_at_cursor']
        print(f"Symbol at cursor: {sym['kind']} {sym['name']}")
        print(f"  Signature: {sym['signature']}")
    print()
    
    # Show first few symbols in file
    print("First 5 symbols in file:")
    for sym in ctx.get('symbols_in_file', [])[:5]:
        print(f"  - {sym['kind']}: {sym['name']} (line {sym['line']})")
    print()


async def test_enhanced_context():
    print("=" * 60)
    print("Testing ENHANCED Context with Transcript Search")
    print("=" * 60)
    
    # Simulate a voice command asking about agents
    transcript = "What are the agents in this project and what does the orchestrator do?"
    
    ctx = await get_context(
        file_path=TEST_FILE,
        cursor_line=1,
        project_root=PROJECT_ROOT,
        transcript=transcript,  # NEW: pass transcript for keyword search
    )
    
    print(f"Transcript: '{transcript}'")
    print(f"Project summary: {ctx.get('project_summary', 'N/A')}")
    print()
    
    # Show relevant snippets found from transcript
    relevant_snippets = ctx.get('relevant_snippets', [])
    print(f"Found {len(relevant_snippets)} relevant code snippets:")
    for snippet in relevant_snippets:
        print(f"  - {snippet['kind']} `{snippet['symbol_name']}` @ {snippet['file_path']}:{snippet['line']}")
        # Show first 100 chars of code
        code_preview = snippet['code'][:100].replace('\n', ' ')
        print(f"    Preview: {code_preview}...")
    print()


async def test_symbol_search():
    print("=" * 60)
    print("Testing Symbol Search from Transcript")
    print("=" * 60)
    
    # Simulate voice command
    query = "show me the coding agent function"
    print(f"Query: '{query}'")
    
    results = await search_project_symbols(query, PROJECT_ROOT, limit=10)
    print(f"Found {len(results)} symbols:")
    for sym in results:
        print(f"  - {sym['kind']}: {sym['name']} @ line {sym['line']}")
    print()
    
    # Another query
    query = "orchestrator workflow"
    print(f"Query: '{query}'")
    
    results = await search_project_symbols(query, PROJECT_ROOT, limit=10)
    print(f"Found {len(results)} symbols:")
    for sym in results:
        print(f"  - {sym['kind']}: {sym['name']} @ line {sym['line']}")


async def main():
    await test_symbol_indexer()
    await test_context_agent()
    await test_enhanced_context()  # NEW: test transcript-based search
    await test_symbol_search()
    print("\n✓ All tests passed!")


if __name__ == "__main__":
    asyncio.run(main())
