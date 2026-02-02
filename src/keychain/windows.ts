import { $ } from "bun";

const TARGET_PREFIX = "ade:";

export async function set(key: string, value: string): Promise<void> {
  const target = `${TARGET_PREFIX}${key}`;
  const script = `
    $cred = New-Object -TypeName PSCredential -ArgumentList '${key}', (ConvertTo-SecureString '${value.replace(/'/g, "''")}' -AsPlainText -Force)
    $bytes = [System.Text.Encoding]::Unicode.GetBytes($cred.GetNetworkCredential().Password)
    cmdkey /generic:"${target}" /user:"${key}" /pass:"${value.replace(/"/g, '""')}"
  `;
  await $`powershell -Command ${script}`.quiet();
}

export async function get(key: string): Promise<string | null> {
  const target = `${TARGET_PREFIX}${key}`;
  const script = `
    $output = cmdkey /list:"${target}" 2>&1
    if ($output -match "NONE") { exit 1 }
    $cred = Get-StoredCredential -Target "${target}" -ErrorAction SilentlyContinue
    if ($cred) { $cred.GetNetworkCredential().Password } else {
      # Fallback: use CredRead via P/Invoke
      Add-Type -TypeDefinition @"
        using System;
        using System.Runtime.InteropServices;
        public class CredManager {
          [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
          public static extern bool CredRead(string target, int type, int flags, out IntPtr credential);
          [DllImport("advapi32.dll")]
          public static extern void CredFree(IntPtr credential);
        }
"@
      $ptr = [IntPtr]::Zero
      if ([CredManager]::CredRead("${target}", 1, 0, [ref]$ptr)) {
        $cred = [Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [Type][Runtime.InteropServices.Marshal]::SizeOf([Type][IntPtr]))
        [CredManager]::CredFree($ptr)
      }
    }
  `;
  const result = await $`powershell -Command ${script}`.quiet().nothrow();
  if (result.exitCode !== 0) return null;
  const text = result.text().trim();
  return text || null;
}

export async function remove(key: string): Promise<boolean> {
  const target = `${TARGET_PREFIX}${key}`;
  const result = await $`cmdkey /delete:"${target}"`.quiet().nothrow();
  return result.exitCode === 0;
}

export async function list(): Promise<string[]> {
  const result = await $`cmdkey /list`.quiet().nothrow();
  if (result.exitCode !== 0) return [];

  const output = result.text();
  const keys: string[] = [];
  const regex = new RegExp(`Target: ${TARGET_PREFIX}(\\S+)`, "g");
  let match;
  while ((match = regex.exec(output)) !== null) {
    keys.push(match[1]);
  }
  return keys;
}
