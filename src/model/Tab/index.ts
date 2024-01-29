import { v4 as uuidv4 } from "uuid";
import { TidyTabs } from "../../types";

export class TidyTabsTabModel {
  static create(createProperties: TidyTabs.TabCreateProperties) {
    // TODO: validate createProperties
    const id = createProperties.id || uuidv4();
    return {
      ...createProperties,
      id,
    } as TidyTabs.Tab;
  }
}
