// 로컬 파일시스템 저장소(T025, research R-06) — serving/common/storage.py(A)와 같은 경로 규칙.
//   family/{artwork_uuid}/{kind}/{uuid}.{ext} · tmp/{job_id}/ · ext/{ext_job_id}/
// 객체 키는 불투명 UUID. 원본은 덮어쓰지 않는다(O_EXCL, 0440, BR-INT-04). 키는 로그에 남기지 않는다.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

export class StorageError extends Error {}

export interface StoragePort {
  putNew(key: string, data: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  absolutePath(key: string): string;
}

export class LocalFsDriver implements StoragePort {
  constructor(readonly root: string) {}

  absolutePath(key: string): string {
    const norm = path.posix.normalize(key);
    if (path.posix.isAbsolute(norm) || norm.split('/').includes('..')) throw new StorageError('bad_key');
    return path.join(this.root, norm);
  }

  static newArtworkPrefix(): string {
    return `family/${randomUUID().replace(/-/g, '')}`;
  }

  static newKey(prefix: string, kind: string, ext: string): string {
    return `${prefix}/${kind}/${randomUUID().replace(/-/g, '')}.${ext.replace(/^\./, '')}`;
  }

  /** tmp에 쓰고 fsync 뒤 확정 위치로 옮긴다. 이미 있으면 실패(덮어쓰기 금지). */
  async putNew(key: string, data: Buffer): Promise<void> {
    const dst = this.absolutePath(key);
    const tmpDir = path.join(this.root, 'tmp', 'intake');
    const tmp = path.join(tmpDir, `${randomUUID()}.part`);
    try {
      await fs.mkdir(tmpDir, { recursive: true });
      await fs.mkdir(path.dirname(dst), { recursive: true });
      const fh = await fs.open(tmp, 'wx', 0o640);
      try {
        await fh.writeFile(data);
        await fh.sync();
      } finally {
        await fh.close();
      }
      const guard = await fs.open(dst, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o640);
      await guard.close();
      await fs.rename(tmp, dst);
      await fs.chmod(dst, 0o440);
    } catch (e) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new StorageError('key_exists');
      throw new StorageError('write_failed');
    }
  }

  async read(key: string): Promise<Buffer> {
    try {
      return await fs.readFile(this.absolutePath(key));
    } catch {
      throw new StorageError('read_failed');
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.absolutePath(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.rm(this.absolutePath(key), { force: true });
    } catch {
      throw new StorageError('delete_failed');
    }
  }
}
