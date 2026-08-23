export type AppStats = {
  totalItems: number;
  markdownItems: number;
  rawItems: number;
  externalItems: number;
  commandItems: number;
  externalOpenItems: number;
  starItems: number;
  taggedItems: number;
  aliasItems: number;
};

export type TagCloudEntry = {
  tag: string;
  count: number;
};
