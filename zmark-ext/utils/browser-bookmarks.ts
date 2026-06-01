import { ZMARK_BOOKMARKS_FOLDER_TITLE } from '@/utils/bookmark-sync-constants';

export type ZMarkLink = {
  title: string;
  url: string;
  description: string;
  backup_url: string;
  sort_order: number;
};

export type ZMarkCategory = {
  name: string;
  description: string;
  links: ZMarkLink[];
  children?: ZMarkCategory[];
};

export type ZMarkBookmarksPayload = {
  type: 'zmark.bookmarks';
  version: 1;
  categories: ZMarkCategory[];
};

type BookmarkNode = {
  title: string;
  url?: string;
  children?: BookmarkNode[];
};

type MutableCategory = {
  name: string;
  description: string;
  links: ZMarkLink[];
  children: MutableCategory[];
};

const DEFAULT_CATEGORY_NAME = '默认分类';

function createCategory(name: string): MutableCategory {
  return {
    name,
    description: '',
    links: [],
    children: [],
  };
}

function createLink(node: BookmarkNode, sortOrder: number): ZMarkLink | null {
  if (!node.url) {
    return null;
  }

  return {
    title: node.title || node.url,
    url: node.url,
    description: '',
    backup_url: '',
    sort_order: sortOrder,
  };
}

function getOrCreateChildCategory(parent: MutableCategory, name: string): MutableCategory {
  const existedCategory = parent.children.find(child => child.name === name);

  if (existedCategory) {
    return existedCategory;
  }

  const childCategory = createCategory(name);
  parent.children.push(childCategory);
  return childCategory;
}

function normalizeCategory(category: MutableCategory): ZMarkCategory {
  const normalizedChildren = category.children
    .map(child => ({
      ...child,
      links: child.links.map((link, index) => ({
        ...link,
        sort_order: index,
      })),
    }))
    .filter(child => child.links.length > 0)
    .map(child => ({
      name: child.name,
      description: child.description,
      links: child.links,
    }));

  return {
    name: category.name,
    description: category.description,
    links: category.links.map((link, index) => ({
      ...link,
      sort_order: index,
    })),
    ...(normalizedChildren.length ? { children: normalizedChildren } : {}),
  };
}

function collectFolderNodes(
  parentCategory: MutableCategory,
  folderNode: BookmarkNode,
  secondLevelName: string,
) {
  const childCategory = getOrCreateChildCategory(parentCategory, secondLevelName);

  for (const childNode of folderNode.children ?? []) {
    if (childNode.url) {
      const link = createLink(childNode, childCategory.links.length);

      if (link) {
        childCategory.links.push(link);
      }

      continue;
    }

    collectFolderNodes(parentCategory, childNode, secondLevelName);
  }
}

function collectTopLevelNode(parentCategory: MutableCategory, node: BookmarkNode) {
  if (node.url) {
    const link = createLink(node, parentCategory.links.length);

    if (link) {
      parentCategory.links.push(link);
    }

    return;
  }

  if (!node.title) {
    return;
  }

  collectFolderNodes(parentCategory, node, node.title);
}

export function mapBrowserBookmarksToZMark(tree: BookmarkNode[]): ZMarkBookmarksPayload {
  const categories: MutableCategory[] = [];
  let defaultCategory: MutableCategory | null = null;

  for (const rootNode of tree) {
    for (const topLevelNode of rootNode.children ?? []) {
      if (topLevelNode.url) {
        if (!defaultCategory) {
          defaultCategory = createCategory(DEFAULT_CATEGORY_NAME);
          categories.push(defaultCategory);
        }

        const link = createLink(topLevelNode, defaultCategory.links.length);

        if (link) {
          defaultCategory.links.push(link);
        }

        continue;
      }

      const category = createCategory(topLevelNode.title || DEFAULT_CATEGORY_NAME);

      for (const childNode of topLevelNode.children ?? []) {
        if (!childNode.url && childNode.title === ZMARK_BOOKMARKS_FOLDER_TITLE) {
          continue;
        }

        collectTopLevelNode(category, childNode);
      }

      if (category.links.length || category.children.some(child => child.links.length > 0)) {
        categories.push(category);
      }
    }
  }

  return {
    type: 'zmark.bookmarks',
    version: 1,
    categories: categories.map(category => normalizeCategory(category)),
  };
}
