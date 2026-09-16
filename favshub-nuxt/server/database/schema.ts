/**
 * Drizzle ORM Schema — 完整映射 FavsHub SQLite 数据库的 10 张表
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
  loginRequired: integer('login_required').default(0),
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
  description: text('description').default(''),
  sortOrder: integer('sort_order').default(0),
  container: text('container').default(''),
  source: text('source').default('[]'),
  loginRequired: integer('login_required').default(0),
  label: text('label').notNull().default(''),
  needProxy: integer('need_proxy').default(0),
  createdAt: integer('created_at'),
  updatedAt: integer('updated_at'),
}, (table) => [
  uniqueIndex('idx_bookmarks_user_url').on(table.userId, table.url),
  index('idx_bookmarks_user_id').on(table.userId),
  index('idx_bookmarks_folder_id').on(table.folderId),
  // C4: 首页书签列表 WHERE user_id+login_required+label!='' ORDER BY created_at DESC 的覆盖索引
  index('idx_bookmarks_user_label_created').on(table.userId, table.loginRequired, table.label, table.createdAt),
])

// ─── prompt_folders ───────────────────────────────────────────
export const promptFolders = sqliteTable('prompt_folders', {
  id: text('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  parentId: text('parent_id'),
  icon: text('icon').default(''),
  sortOrder: integer('sort_order').default(0),
  loginRequired: integer('login_required').default(0),
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
  usageCount: integer('usage_count').default(0),
  deletedAt: integer('deleted_at'),
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
  changeNote: text('change_note').default(''),
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
  userId: integer('user_id').default(0),
  name: text('name').notNull(),
  label: text('label'),
  url: text('url').notNull(),
  icon: text('icon'),
  category: text('category').default('SEARCH'),
  sortOrder: integer('sort_order').default(0),
  isDefault: integer('is_default').default(0),
  status: text('status').default('approved'),
  createdAt: integer('created_at'),
})

// ─── collections（精选集）─────────────────────────────────────
export const collections = sqliteTable('collections', {
  id: text('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').default(''),
  icon: text('icon').default(''),
  metaTitle: text('meta_title').default(''),
  metaDescription: text('meta_description').default(''),
  metaKeywords: text('meta_keywords').default(''),
  isPublic: integer('is_public').default(0),
  isOfficial: integer('is_official').default(0),
  bookmarkCount: integer('bookmark_count').default(0),
  createdAt: integer('created_at'),
  updatedAt: integer('updated_at'),
}, (table) => [
  index('idx_collections_user_id').on(table.userId),
  index('idx_collections_public').on(table.isPublic, table.isOfficial),
])

// ─── collection_categories（精选集分类，支持二级）────────────
export const collectionCategories = sqliteTable('collection_categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  collectionId: text('collection_id').notNull().references(() => collections.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  parentId: integer('parent_id').references((): any => collectionCategories.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').default(0),
  createdAt: integer('created_at'),
}, (table) => [
  index('idx_cc_collection').on(table.collectionId),
  index('idx_cc_parent').on(table.parentId),
])

// ─── collection_bookmarks（精选集书签 → 引用 bookmarks）───────
export const collectionBookmarks = sqliteTable('collection_bookmarks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  collectionId: text('collection_id').notNull().references(() => collections.id, { onDelete: 'cascade' }),
  bookmarkId: integer('bookmark_id').notNull().references(() => bookmarks.id, { onDelete: 'cascade' }),
  categoryId: integer('category_id').references(() => collectionCategories.id, { onDelete: 'set null' }),
  sortOrder: integer('sort_order').default(0),
  createdAt: integer('created_at'),
}, (table) => [
  index('idx_cb_collection').on(table.collectionId),
  index('idx_cb_category').on(table.categoryId),
  index('idx_cb_bookmark').on(table.bookmarkId),
  uniqueIndex('idx_cb_collection_bookmark').on(table.collectionId, table.bookmarkId),
  // M8: 精选集书签列表 JOIN + ORDER BY sort_order 的复合索引
  index('idx_cb_collection_sort').on(table.collectionId, table.sortOrder),
])

// ─── collection_subscriptions（用户订阅关系）──────────────────
export const collectionSubscriptions = sqliteTable('collection_subscriptions', {
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  collectionId: text('collection_id').notNull().references(() => collections.id, { onDelete: 'cascade' }),
  subscribedAt: integer('subscribed_at'),
}, (table) => [
  index('idx_cs_user').on(table.userId),
  // 复合主键在迁移中定义: PRIMARY KEY (user_id, collection_id)
])

// ─── collection_imports（用户导入记录）────────────────────────
export const collectionImports = sqliteTable('collection_imports', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  collectionId: text('collection_id').notNull().references(() => collections.id, { onDelete: 'cascade' }),
  collectionBookmarkId: integer('collection_bookmark_id').notNull().references(() => collectionBookmarks.id, { onDelete: 'cascade' }),
  bookmarkId: integer('bookmark_id').notNull().references(() => bookmarks.id, { onDelete: 'cascade' }),
  importedAt: integer('imported_at'),
}, (table) => [
  index('idx_ci_user_collection').on(table.userId, table.collectionId),
  uniqueIndex('idx_ci_unique').on(table.userId, table.collectionId, table.collectionBookmarkId),
])

// ─── system_config ────────────────────────────────────────────
// 系统级配置（TDK、注册开关等），独立于用户设置
export const systemConfig = sqliteTable('system_config', {
  key: text('key').primaryKey(),
  value: text('value').default(''),
  updatedAt: integer('updated_at'),
})

// ─── token_deals（Token 白嫖通告）──────────────────────────────
// 免费额度 / 免费模型的时效性通告。与 collections 的区别：通告有时效、
// 需审核、可用性由社区投票背书。
export const tokenDeals = sqliteTable('token_deals', {
  id: text('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),          // 服务商名称
  title: text('title').notNull(),                // 通告标题
  url: text('url').notNull(),                    // 领取 / 活动页
  callUrl: text('call_url').default(''),         // API 调用地址
  quota: text('quota').default(''),              // 免费额度描述
  models: text('models').default('[]'),          // 支持模型 JSON 数组
  region: text('region').default('cn'),          // cn | global
  quality: text('quality').default('中品'),       // 上上品|上品|中品|下品|下下品
  sourceTag: text('source_tag').default('official'), // official|relay|community
  expiresAt: integer('expires_at'),              // 有效期截止（NULL = 永久）
  pinned: integer('pinned').default(0),
  note: text('note').default(''),                // 备注 / 使用提示
  status: text('status').default('pending'),     // pending|approved|rejected
  rejectReason: text('reject_reason').default(''),
  voteUp: integer('vote_up').default(0),         // 缓存计数
  voteDown: integer('vote_down').default(0),
  ratingSum: integer('rating_sum').default(0),
  ratingCount: integer('rating_count').default(0),
  createdAt: integer('created_at'),
  updatedAt: integer('updated_at'),
}, (table) => [
  index('idx_td_status').on(table.status, table.pinned),
  index('idx_td_user').on(table.userId),
  index('idx_td_region').on(table.region, table.quality),
])

// ─── token_deal_votes（可用性投票，一人一票可改）────────────────
export const tokenDealVotes = sqliteTable('token_deal_votes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  dealId: text('deal_id').notNull().references(() => tokenDeals.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  vote: text('vote').notNull(),                  // up | down
  createdAt: integer('created_at'),
  updatedAt: integer('updated_at'),
}, (table) => [
  uniqueIndex('idx_tdv_unique').on(table.dealId, table.userId),
  index('idx_tdv_deal').on(table.dealId),
])

// ─── token_deal_reviews（真实评测，一人一评可改）────────────────
export const tokenDealReviews = sqliteTable('token_deal_reviews', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  dealId: text('deal_id').notNull().references(() => tokenDeals.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  rating: integer('rating').notNull(),           // 1-5
  content: text('content').notNull(),
  createdAt: integer('created_at'),
  updatedAt: integer('updated_at'),
}, (table) => [
  uniqueIndex('idx_tdr_unique').on(table.dealId, table.userId),
  index('idx_tdr_deal').on(table.dealId),
])
