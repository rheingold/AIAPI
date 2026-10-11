"""
Test Python script for FS_WRITE escaping validation.
This file should write correctly since Python has no $ or backtick issues.
"""
import os
import sys
import json

# --- String escaping ---
single_quoted = 'Hello, World!'
double_quoted = "She said \"hello\""
triple_quoted = '''It's "working" fine'''
raw_string = r"C:\Users\test\notes\file.txt"
f_string = f"Path: {os.getcwd()}, Count: {42}"

# --- Special characters ---
unicode_str = "Hello 世界 🌍 café"
escaped_chars = "line1\nline2\tcol2\r\nline3"
backslash_path = "C:\\Program Files (x86)\\App\\subdir"
forward_path = "/usr/local/bin/python"

# --- Multiline strings ---
docstring = """
This is a multi-line string with:
- $dollar signs (not special in Python)
- `backticks` (not special in Python)
- "double quotes" and 'single quotes'
- Paths: C:\\Windows and /usr/bin
- HTML: <div class="test">Content & more</div>
"""

# --- Dictionary with special keys/values ---
config = {
    "host": "localhost",
    "port": 8080,
    "path": "/api/v1",
    "query": "a=1&b=2",
    "nested": {
        "inner": "value",
        "special": "p@ssw0rd!"
    },
    "regex": r"\b[A-Z]{2,}\b",
    "sql": "SELECT * FROM users WHERE name = 'O''Brien'",
}

# --- Class definition ---
class FileProcessor:
    """Process files with special character handling."""
    
    def __init__(self, input_path: str, output_path: str):
        self.input_path = input_path
        self.output_path = output_path
        self._results = []
    
    def process(self, data: str) -> str:
        """Process data string."""
        result = data.replace("&", "&").replace("<", "<")
        return result
    
    def write_output(self, content: str):
        """Write to file."""
        with open(self.output_path, 'w', encoding='utf-8') as f:
            f.write(content)

# --- Exception handling ---
try:
    result = 1 / 0
except ZeroDivisionError as e:
    print(f"Error: {e}")
finally:
    print("Cleanup")

# --- Decorator and lambda ---
@staticmethod
def transform(fn):
    return lambda x: fn(x).upper()

# --- Type hints ---
def calculate(a: float, b: float) -> float:
    return (a + b) / 2

# --- Shell command execution (embedded shell) ---
shell_cmd = 'powershell.exe -Command "$var = \'hello\'; Write-Host $var"'
batch_cmd = '@echo off & set "VAR=value" & echo %VAR%'

# --- JSON serialization test ---
json_output = json.dumps(config, indent=2, ensure_ascii=False)

# --- List comprehensions ---
numbers = [x * 2 for x in range(10) if x % 2 == 0]

# --- Context managers ---
import tempfile
with tempfile.TemporaryDirectory() as tmpdir:
    test_file = os.path.join(tmpdir, "test.txt")
    with open(test_file, "w") as f:
        f.write("test content")

# End of test Python script
