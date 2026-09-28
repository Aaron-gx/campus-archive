import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

/// SQLite 本地数据库（账号数据的离线镜像 + 待同步队列）
class AppDb {
  Database? _db;

  Future<Database> get() async {
    if (_db != null) return _db!;
    final dir = await getDatabasesPath();
    _db = await openDatabase(
      p.join(dir, 'campus_archive.db'),
      version: 3,
      onCreate: (db, v) async {
        await db.execute('''
          CREATE TABLE profile (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            nickname TEXT NOT NULL,
            school TEXT NOT NULL DEFAULT '',
            password_hash TEXT NOT NULL,
            password_salt TEXT NOT NULL,
            created_at INTEGER NOT NULL
          )''');
        await _createDocTables(db);
      },
      onUpgrade: (db, oldV, newV) async {
        if (oldV < 2) {
          // v1（双模式时代）的存量数据视为"待上传"：
          // 登录账号后会自动推送到服务器，实现本地数据迁移
          await _ensureSyncColumns(db, markAllPending: true);
        }
        if (oldV < 3) {
          // v3：多面证件组（groupId/side/sideOrder/meta）与存证核验（verifyCode/sha256）
          await _ensureV3Columns(db);
        }
      },
    );
    return _db!;
  }

  static Future<void> _createDocTables(Database db) async {
    await db.execute('''
          CREATE TABLE documents (
            id TEXT PRIMARY KEY,
            category_key TEXT NOT NULL,
            title TEXT NOT NULL,
            file_name TEXT NOT NULL,
            stored_name TEXT NOT NULL,
            mime TEXT NOT NULL,
            size INTEGER NOT NULL,
            is_sensitive INTEGER NOT NULL DEFAULT 0,
            e2ee INTEGER NOT NULL DEFAULT 0,
            note TEXT,
            group_id TEXT,
            side TEXT,
            side_order INTEGER,
            meta TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            remote_id TEXT,
            pending_op TEXT
          )''');
    await db.execute('''
          CREATE TABLE certificates (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            org TEXT NOT NULL,
            level TEXT NOT NULL,
            awarded_at INTEGER NOT NULL,
            note TEXT,
            document_id TEXT,
            created_at INTEGER NOT NULL,
            remote_id TEXT,
            pending_op TEXT
          )''');
    await db.execute('''
          CREATE TABLE export_records (
            id TEXT PRIMARY KEY,
            category_keys TEXT NOT NULL,
            file_name TEXT NOT NULL,
            size INTEGER NOT NULL,
            verify_code TEXT,
            sha256 TEXT,
            manifest_summary TEXT,
            watermark_text TEXT,
            created_at INTEGER NOT NULL
          )''');
    await db.execute('''
          CREATE TABLE access_logs (
            id TEXT PRIMARY KEY,
            action TEXT NOT NULL,
            doc_title TEXT NOT NULL,
            created_at INTEGER NOT NULL
          )''');
  }

  /// 幂等补列；[markAllPending] 时把存量行标记为待上传（老数据迁移）
  static Future<void> _ensureSyncColumns(Database db,
      {bool markAllPending = false}) async {
    for (final t in ['documents', 'certificates']) {
      final cols = await db.rawQuery('PRAGMA table_info($t)');
      final names = cols.map((c) => c['name'] as String).toSet();
      if (!names.contains('remote_id')) {
        await db.execute('ALTER TABLE $t ADD COLUMN remote_id TEXT');
      }
      if (!names.contains('pending_op')) {
        await db.execute('ALTER TABLE $t ADD COLUMN pending_op TEXT');
      }
      if (markAllPending) {
        await db.execute(
            "UPDATE $t SET pending_op = 'create' WHERE pending_op IS NULL");
      }
    }
  }

  /// v3 增量补列（多面证件组与存证核验）
  static Future<void> _ensureV3Columns(Database db) async {
    final docCols = await db.rawQuery('PRAGMA table_info(documents)');
    final docNames = docCols.map((c) => c['name'] as String).toSet();
    if (!docNames.contains('e2ee')) {
      await db.execute('ALTER TABLE documents ADD COLUMN e2ee INTEGER NOT NULL DEFAULT 0');
    }
    if (!docNames.contains('group_id')) {
      await db.execute('ALTER TABLE documents ADD COLUMN group_id TEXT');
    }
    if (!docNames.contains('side')) {
      await db.execute('ALTER TABLE documents ADD COLUMN side TEXT');
    }
    if (!docNames.contains('side_order')) {
      await db.execute('ALTER TABLE documents ADD COLUMN side_order INTEGER');
    }
    if (!docNames.contains('meta')) {
      await db.execute('ALTER TABLE documents ADD COLUMN meta TEXT');
    }

    final expCols = await db.rawQuery('PRAGMA table_info(export_records)');
    final expNames = expCols.map((c) => c['name'] as String).toSet();
    if (!expNames.contains('verify_code')) {
      await db.execute('ALTER TABLE export_records ADD COLUMN verify_code TEXT');
    }
    if (!expNames.contains('sha256')) {
      await db.execute('ALTER TABLE export_records ADD COLUMN sha256 TEXT');
    }
    if (!expNames.contains('manifest_summary')) {
      await db.execute('ALTER TABLE export_records ADD COLUMN manifest_summary TEXT');
    }
    if (!expNames.contains('watermark_text')) {
      await db.execute('ALTER TABLE export_records ADD COLUMN watermark_text TEXT');
    }
  }
}
