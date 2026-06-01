export type CategoryApiItem = {
  id: number;
  name: string;
  description: string;
  icon: string;
  icon_color: string;
  sort_order: number;
  is_public: number;
  created_at: string;
  children?: CategoryApiChild[];
};

export type CategoryApiChild = {
  id: number;
  name: string;
  description: string;
  icon: string;
  icon_color: string;
  sort_order: number;
  is_public: number;
  created_at: string;
};

export type CategoryNode = {
  id: number;
  name: string;
  description: string;
  icon: string;
  iconColor: string;
  sortOrder: number;
  isPublic: number;
  createdAt: string;
  children: CategoryNode[];
};

export function mapCategory(item: CategoryApiItem | CategoryApiChild): CategoryNode {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    icon: item.icon,
    iconColor: item.icon_color,
    sortOrder: item.sort_order,
    isPublic: item.is_public,
    createdAt: item.created_at,
    children: 'children' in item
      ? (item.children ?? []).slice().sort((left, right) => left.sort_order - right.sort_order).map(child => mapCategory(child))
      : [],
  };
}
