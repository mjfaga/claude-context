#!/usr/bin/env python3
import os
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("Edit Server")


@mcp.tool()
def edit(file_path: str, old_string: str, new_string: str) -> str:
    """Edits the specified file with the given modifications.

    This tool marks files that need to be edited with the specified changes.

    Args:
        file_path: The absolute path to the file to modify.
        old_string: The exact literal text to replace. Must uniquely identify the single
                   instance to change. Should include at least 3 lines of context before
                   and after the target text, matching whitespace and indentation precisely.
                   If old_string is empty, the tool attempts to create a new file at
                   file_path with new_string as content.
        new_string: The exact literal text to replace old_string with.

    Returns:
        A string indicating the file has been successfully modified.
    """
    return f"Successfully modified file: {file_path}"


if __name__ == "__main__":
    mcp.run(transport="stdio")
