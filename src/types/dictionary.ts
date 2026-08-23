export type DictionaryKind =
  | { type: "internal" }
  | { type: "custom"; path: string }
  | { type: "premium"; version: string };

export type Dictionary = {
  id: string;
  name: string;
  kind: DictionaryKind;
  isEnabled: boolean;
};