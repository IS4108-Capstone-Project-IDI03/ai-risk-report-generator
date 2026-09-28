from pathlib import Path

def get_fixture():
    path = Path(__file__).parent / "test_files"
    # Uncomment the fixture you want to use for testing. 
       
    # FIXTURE = path / "Tyco Hygood FM-200 Engineered Manual.pdf"
    FIXTURE = path / "Mixed Use Development Sample 1 - PRE 2025 - REDACTED.pdf"
    # FIXTURE = path / "Office Sample 5 - PRE 2026 - REDACTED.pdf"
    # FIXTURE = path / "Shopping Mall Sample 2 - PRE 2025 - REDACTED.pdf"
    return FIXTURE