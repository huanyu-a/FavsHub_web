/**
 * Drizzle ORM Schema — 完整映射 FavsHub SQLite 数据库的 10 张表
 * 与 wwwroot/server/db.js 中的表结构完全一致（含所有迁移列）
 */
import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core'

// ─── users ────────────────────────────────────────────────────
export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  email: text('email').unique(),
  passwordHash: text('password_hash').notNull(),
  isAdmin: integer('is_admin').default(0),
  nickname: text('nickname').default(''),
  createdAt: integer('created_at'),
}, (table) => [
  // users 表的主键自增从 1 开始，但系统用户 id=0 是手动插入的
])

// ─── folders ──────────────────────────────────────────────────
export const folders = sqliteTable('folders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  parentId: integer('parent_id').references((): any => folders.id),
  sortOrder: integer('sort_order').default(0),
  icon: text('icon').default(''),
  createdAt: integer('created_at'),
  updatedAt: integer('updated_at'),
}, (table) => [
  index('idx_folders_user_id').on(table.userId),
  index('idx_folders_parent_id').on(table.parentId),
])

// ─── bookmarks ────────────────────────────────────────────────
export const bookmarks = sqliteTable('bookmarks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  title: text('title').notNull(),
  url: text('url').notNull(),
  folderId: integer('folder_id').references(() => folders.id),
  icon: text('icon'),
  sortOrder: integer('sort_order').default(0),
  container: text('container').default(''),
  source: text('source').default(''),
  loginRequired: integer('login_required').default(0),
  createdAt: integer('created_at'),
  updatedAt: integer('updated_at'),
}, (table) => [
  uniqueIndex('idx_bookmarks_user_url').on(table.userId, table.url),
  index('idx_bookmarks_user_id').on(table.userId),
  index('idx_bookmarks_folder_id').on(table.folderId),
])

// ─── prompt_folders ───────────────────────────────────────────
export const promptFolders = sqliteTable('prompt_folders', {
  id: text('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  parentId: text('parent_id'),
  icon: text('icon').default(''),
  createdAt: integer('created_at'),
  updatedAt: integer('updated_at'),
}, (table) => [
  index('idx_prompt_folders_user_id').on(table.userId),
])

// ─── prompts ──────────────────────────────────────────────────
export const prompts = sqliteTable('prompts', {
  id: text('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  title: text('title').notNull(),
  description: text('description'),
  content: text('content').notNull(),
  folderId: text('folder_id').references(() => promptFolders.id),
  isFavorite: integer('is_favorite').default(0),
  avatar: text('avatar').default(''),
  loginRequired: integer('login_required').default(0),
  versionCount: integer('version_count').default(0),
  currentVersion: text('current_version').default('1.0.0'),
  createdAt: integer('created_at'),
  updatedAt: integer('updated_at'),
}, (table) => [
  index('idx_prompts_user_id').on(table.userId),
  index('idx_prompts_folder_id').on(table.folderId),
])

// ─── tags ─────────────────────────────────────────────────────
export const tags = sqliteTable('tags', {
  id: text('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  color: text('color').default(''),
  createdAt: integer('created_at'),
  updatedAt: integer('updated_at'),
}, (table) => [
  index('idx_tags_user_id').on(table.userId),
])

// ─── prompt_tags (多对多关联) ─────────────────────────────────
export const promptTags = sqliteTable('prompt_tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  promptId: text('prompt_id').notNull().references(() => prompts.id, { onDelete: 'cascade' }),
  tagId: text('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at'),
}, (table) => [
  index('idx_prompt_tags_prompt_id').on(table.promptId),
  index('idx_prompt_tags_tag_id').on(table.tagId),
])

// ─── prompt_versions ──────────────────────────────────────────
export const promptVersions = sqliteTable('prompt_versions', {
  id: text('id').primaryKey(),
  promptId: text('prompt_id').notNull().references(() => prompts.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  versionNumber: text('version_number').notNull(),
  variables: text('variables').default(''),
  createdAt: integer('created_at'),
}, (table) => [
  index('idx_prompt_versions_prompt_id').on(table.promptId),
])

// ─── settings ─────────────────────────────────────────────────
// user_id 既是 PK 又是 FK，id=0 为系统全局设置
export const settings = sqliteTable('settings', {
  userId: integer('user_id').primaryKey().references(() => users.id),
  data: text('data').default('{}'),
})

// ─── search_engines ───────────────────────────────────────────
export const searchEngines = sqliteTable('search_engines', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  label: text('label'),
  url: text('url').notNull(),
  icon: text('icon'),
  category: text('category').default('SEARCH'),
  sortOrder: integer('sort_order').default(0),
  isDefault: integer('is_default').default(0),
  createdAt: integer('created_at'),
})
