#!/usr/bin/env python3

import json
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional


class TypeScriptExecutor:
    def __init__(self, working_dir: Optional[str] = None):
        self.working_dir = working_dir or os.getcwd()

    def call_method(self, ts_file_path: str, method_name: str, *args, **kwargs) -> Any:
        if not os.path.isabs(ts_file_path):
            ts_file_path = os.path.join(self.working_dir, ts_file_path)

        if not os.path.exists(ts_file_path):
            raise FileNotFoundError(f"TypeScript file not found: {ts_file_path}")

        target_dir = os.path.dirname(ts_file_path)

        wrapper_code = self._create_wrapper_script(
            ts_file_path, method_name, list(args), kwargs
        )

        temp_fd, temp_file = tempfile.mkstemp(suffix=".ts", dir=target_dir)

        try:
            with os.fdopen(temp_fd, "w", encoding="utf-8") as f:
                f.write(wrapper_code)

            process = subprocess.Popen(
                ["npx", "ts-node", temp_file],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                cwd=self.working_dir,
                bufsize=1,
                universal_newlines=True,
            )

            stdout_lines = []
            stderr_lines = []

            while True:
                output = process.stdout.readline()
                if output == "" and process.poll() is not None:
                    break
                if output:
                    line = output.strip()
                    stdout_lines.append(line)

                    try:
                        json.loads(line)
                    except json.JSONDecodeError:
                        print(line)

            stderr_output = process.stderr.read()
            if stderr_output:
                stderr_lines.append(stderr_output.strip())

            return_code = process.poll()

            if return_code != 0:
                error_msg = "\n".join(stderr_lines) if stderr_lines else "Unknown error"
                raise RuntimeError(f"TypeScript execution failed: {error_msg}")

            for line in reversed(stdout_lines):
                if line.strip():
                    try:
                        return json.loads(line)
                    except json.JSONDecodeError:
                        continue

            for line in reversed(stdout_lines):
                if line.strip():
                    return line

            return None

        except Exception as e:
            raise RuntimeError(f"Execution error: {str(e)}")
        finally:
            os.unlink(temp_file)

    def _create_wrapper_script(
        self,
        ts_file_path: str,
        method_name: str,
        args: List[Any],
        kwargs: Dict[str, Any],
    ) -> str:

        ts_filename = os.path.basename(ts_file_path)

        if ts_filename.endswith(".ts"):
            import_path = "./" + ts_filename[:-3]
        else:
            import_path = "./" + ts_filename

        args_json = json.dumps(args)
        kwargs_json = json.dumps(kwargs)

        wrapper_code = f"""
import * as targetModule from '{import_path}';

async function executeMethod() {{
    try {{
        // Prepare arguments
        const args: any[] = {args_json};
        const kwargs: any = {kwargs_json};
        
        // Get method
        const method = (targetModule as any).{method_name};
        if (typeof method !== 'function') {{
            throw new Error(`Method '{method_name}' does not exist or is not a function`);
        }}
        
        // Call method
        let result: any;
        if (Object.keys(kwargs).length > 0) {{
            // If there are keyword arguments, pass them as the last parameter
            result = await method(...args, kwargs);
        }} else {{
            // Only positional arguments
            result = await method(...args);
        }}
        
        // Output result
        console.log(JSON.stringify(result));
    }} catch (error: any) {{
        console.error(JSON.stringify({{
            error: (error as Error).message,
            stack: (error as Error).stack
        }}));
        process.exit(1);
    }}
}}

executeMethod();
"""
        return wrapper_code


def call_ts_method(
    ts_file: str, method_name: str, *args, working_dir: Optional[str] = None, **kwargs
) -> Any:
    executor = TypeScriptExecutor(working_dir)
    return executor.call_method(ts_file, method_name, *args, **kwargs)


if __name__ == "__main__":

    test_ts_content = """
export function add(a: number, b: number): number {
    return a + b;
}

export function greet(name: string, options?: { formal?: boolean }): string {
    const greeting = options?.formal ? "Hello" : "Hi";
    return `${greeting}, ${name}!`;
}

export async function processData(data: any[]): Promise<{ count: number; items: any[] }> {
    // Simulate async processing
    await new Promise(resolve => setTimeout(resolve, 100));
    
    return {
        count: data.length,
        items: data.map(item => ({ processed: true, original: item }))
    };
}

export function complexFunction(
    numbers: number[], 
    config: { multiplier: number; offset: number }
): { result: number[]; sum: number } {
    const result = numbers.map(n => n * config.multiplier + config.offset);
    const sum = result.reduce((a, b) => a + b, 0);
    
    return { result, sum };
}
"""

    with open("test_methods.ts", "w") as f:
        f.write(test_ts_content)

    try:
        executor = TypeScriptExecutor()

        print("=== TypeScript Method Execution Test ===")

        print("\n1. Testing simple addition function:")
        result = executor.call_method("test_methods.ts", "add", 10, 20)
        print(f"   add(10, 20) = {result}")

        print("\n2. Testing greeting function:")
        result1 = executor.call_method("test_methods.ts", "greet", "Alice")
        print(f"   greet('Alice') = {result1}")

        result2 = executor.call_method(
            "test_methods.ts", "greet", "Bob", {"formal": True}
        )
        print(f"   greet('Bob', {{formal: true}}) = {result2}")

        print("\n3. Testing async function:")
        result = executor.call_method(
            "test_methods.ts", "processData", [1, 2, 3, "hello"]
        )
        print(f"   processData([1, 2, 3, 'hello']) = {result}")

        print("\n4. Testing complex function:")
        result = executor.call_method(
            "test_methods.ts",
            "complexFunction",
            [1, 2, 3, 4, 5],
            {"multiplier": 2, "offset": 1},
        )
        print(f"   complexFunction([1,2,3,4,5], {{multiplier:2, offset:1}}) = {result}")

        print("\n5. Testing convenience function:")
        result = call_ts_method("test_methods.ts", "add", 100, 200)
        print(f"   call_ts_method('test_methods.ts', 'add', 100, 200) = {result}")

    except Exception as e:
        print(f"Error: {e}")

    finally:
        if os.path.exists("test_methods.ts"):
            os.remove("test_methods.ts")
