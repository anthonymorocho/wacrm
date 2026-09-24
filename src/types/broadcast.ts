export type AudienceType = 'all' | 'tags' | 'custom_field' | 'csv';

export type CustomFieldOperator = 'is' | 'is_not' | 'contains';

export interface CustomFieldFilter {
  fieldId: string;
  operator: CustomFieldOperator;
  value: string;
}

export interface CsvBroadcastContact {
  phone: string;
  name?: string;
  /** Extra values from this CSV row, kept only in the campaign flow. */
  columnValues: Record<string, string>;
}

export interface AudienceConfig {
  type: AudienceType;
  tagIds?: string[];
  customField?: CustomFieldFilter;
  csvContacts?: CsvBroadcastContact[];
  csvColumns?: string[];
  /** Contacts carrying any of these tags are subtracted from the result. */
  excludeTagIds?: string[];
}

export type VariableMapping =
  | { type: 'static'; value: string }
  | { type: 'field'; value: string }
  | { type: 'custom_field'; value: string }
  | { type: 'csv_column'; value: string };
