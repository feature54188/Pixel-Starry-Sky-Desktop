import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, realpath, rename, rm } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

const writes = new Map<string, Promise<unknown>>()
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

async function snapshot(file: string) {
  try {
    const stat = await lstat(file)
    if (!stat.isFile()) throw new Error('项目约定必须是普通文件')
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const opened = await handle.stat()
      if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino)
        throw new Error('文件已更改，请重新读取')
      const bytes = await handle.readFile()
      return { content: bytes.toString('utf8'), version: hash(bytes), mode: opened.mode }
    } finally {
      await handle.close()
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    return { content: '', version: 'missing', mode: 0o644 }
  }
}

export async function projectGuide(
  root: string,
  action: string,
  content: string | undefined,
  version: string | undefined,
  authorize: () => void,
) {
  if (!isAbsolute(root)) throw new Error('本机默认项目缺少有效根目录')
  const directory = await realpath(root)
  const file = join(directory, 'AGENTS.md')
  const claudeFiles = []
  for (const name of ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md']) {
    try {
      const info = await lstat(join(directory, name))
      if (info.isFile() || info.isSymbolicLink()) claudeFiles.push(name)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
  }
  const hint = claudeFiles.length
    ? {
        claudeHint:
          '项目中已有 ' + claudeFiles.join('、') + '。Claude Code 默认优先读取这些文件，由用户决定是否引用 AGENTS.md。',
      }
    : {}
  if (action === 'read') {
    const current = await snapshot(file)
    authorize()
    return { content: current.content, version: current.version, ...hint }
  }
  if (action !== 'write' || typeof content !== 'string' || !version) throw new Error('写入时需要全文和读取到的版本')
  const bytes = Buffer.from(content, 'utf8')
  if (bytes.length > 32 * 1024) throw new Error('项目约定最多 32 KB')
  const key = process.platform === 'win32' ? file.toLowerCase() : file
  const write = (writes.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      authorize()
      const current = await snapshot(file)
      if (version !== current.version) throw new Error('项目约定已更改，请重新读取')
      const temp = join(directory, '.AGENTS.' + randomUUID() + '.tmp')
      const handle = await open(temp, 'wx', current.mode)
      try {
        try {
          await handle.writeFile(bytes)
        } finally {
          await handle.close()
        }
        if ((await realpath(root)) !== directory || (await snapshot(file)).version !== version)
          throw new Error('项目约定已更改，请重新读取')
        authorize()
        await rename(temp, file)
        return { version: hash(bytes), ...hint }
      } finally {
        await rm(temp, { force: true })
      }
    })
  writes.set(key, write)
  try {
    return await write
  } finally {
    if (writes.get(key) === write) writes.delete(key)
  }
}
