import { DataModel, ChromeTabWithId } from "../../types";
import { v4 as uuidv4 } from "uuid";

export namespace ActiveWindowTab {
  export function create(createProperties: DataModel.ActiveTabCreateProperties) {
    // TODO: validate createProperties
    const id = createProperties.id || uuidv4();
    return {
      ...createProperties,
      id,
    } as DataModel.ActiveTab;
  }

  export function createFromExistingTab(tab: ChromeTabWithId) {
    return create({
      tabInfo: {
        id: tab.id,
        url: tab.url,
        title: tab.title,
      },
    });
  }
}
