#!/usr/bin/env python3
"""Adapted from Gemini CLI grep.ts: https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/tools/grep.ts"""

import os
import subprocess
from typing import Dict, Any, Optional
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("Grep Server")


def is_git_repository(path: str) -> bool:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--git-dir"],
            cwd=path,
            capture_output=True,
            text=True,
            timeout=5,
        )
        return result.returncode == 0
    except (subprocess.SubprocessError, subprocess.TimeoutExpired, FileNotFoundError):
        return False


@mcp.tool()
def search_text(
    pattern: str, path: Optional[str] = None, include: Optional[str] = None
) -> Dict[str, Any]:
    """Searches for a regular expression pattern within the content of files in a specified directory (or current working directory). Can filter files by a glob pattern. Returns the lines containing matches, along with their file paths and line numbers.

    Args:
        pattern: The regular expression (regex) pattern to search for within file contents (e.g., 'function\\s+myFunction', 'import\\s+\\{.*\\}\\s+from\\s+.*').
        path: Optional: The absolute path to the directory to search within. If omitted, searches the current working directory.
        include: Optional: A glob pattern to filter which files are searched (e.g., '*.js', '*.{ts,tsx}', 'src/**'). If omitted, searches all files (respecting potential global ignores).

    Returns:
        A dictionary containing search results with file paths, line numbers, and matching lines.
    """
    search_path = path if path else os.getcwd()

    if not os.path.exists(search_path):
        return {"error": f"Path does not exist: {search_path}", "matches": []}

    try:
        if is_git_repository(search_path):
            try:
                git_cmd = ["git", "grep", "-n", "-E"]

                if include:
                    git_cmd.extend(["--", include])
                else:
                    git_cmd.append("--")

                git_cmd.insert(-1, pattern)  # Insert pattern before the "--" separator

                result = subprocess.run(
                    git_cmd,
                    cwd=search_path,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="ignore",
                    timeout=30,
                )

                if result.returncode == 0:
                    matches = []
                    if result.stdout:
                        for line in result.stdout.strip().split("\n"):
                            if ":" in line:
                                parts = line.split(":", 2)
                                if len(parts) >= 3:
                                    file_path = parts[0]
                                    try:
                                        line_number = int(parts[1])
                                        line_content = parts[2]
                                        matches.append(
                                            {
                                                "file": os.path.join(
                                                    search_path, file_path
                                                )
                                                if not os.path.isabs(file_path)
                                                else file_path,
                                                "line_number": line_number,
                                                "line_content": line_content,
                                                "match": pattern,
                                            }
                                        )
                                    except ValueError:
                                        continue

                    return {
                        "pattern": pattern,
                        "search_path": search_path,
                        "total_matches": len(matches),
                        "matches": matches,
                        "command": " ".join(git_cmd),
                        "method": "git grep",
                    }

            except (
                subprocess.SubprocessError,
                subprocess.TimeoutExpired,
                FileNotFoundError,
            ):
                pass

        cmd = [
            "grep",
            "-n",
            "-r",
            "-E",
        ]

        if include:
            cmd.extend(["--include", include])

        cmd.extend(
            [
                "--exclude-dir=.git",
                "--exclude-dir=node_modules",
                "--exclude-dir=__pycache__",
                "--exclude-dir=.svn",
                "--exclude-dir=.hg",
                "--exclude-dir=venv",
                "--exclude-dir=env",
                "--exclude=*.pyc",
                "--exclude=*.pyo",
                "--exclude=*.so",
                "--exclude=*.dll",
                "--exclude=*.exe",
                "--exclude=*.jpg",
                "--exclude=*.jpeg",
                "--exclude=*.png",
                "--exclude=*.gif",
                "--exclude=*.zip",
                "--exclude=*.tar",
                "--exclude=*.gz",
                "--exclude=*.pdf",
                "--exclude=*.wasm",
            ]
        )

        cmd.extend([pattern, search_path])

        result = subprocess.run(
            cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore"
        )

        matches = []
        if result.stdout:
            for line in result.stdout.strip().split("\n"):
                if ":" in line:
                    parts = line.split(":", 2)
                    if len(parts) >= 3:
                        file_path = parts[0]
                        try:
                            line_number = int(parts[1])
                            line_content = parts[2]
                            matches.append(
                                {
                                    "file": file_path,
                                    "line_number": line_number,
                                    "line_content": line_content,
                                    "match": pattern,
                                }
                            )
                        except ValueError:
                            continue

        return {
            "pattern": pattern,
            "search_path": search_path,
            "total_matches": len(matches),
            "matches": matches,
            "command": " ".join(cmd),
            "method": "system grep",
        }

    except subprocess.SubprocessError as e:
        return {"error": f"Grep command failed: {str(e)}", "matches": []}
    except Exception as e:
        return {"error": f"Unexpected error: {str(e)}", "matches": []}


if __name__ == "__main__":
    mcp.run(transport="stdio")
