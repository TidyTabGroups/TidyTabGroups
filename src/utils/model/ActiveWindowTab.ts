import { TidyTabs, ChromeTabWithId } from "../../types";
import { v4 as uuidv4 } from "uuid";

export namespace ActiveWindowTab {
  export function create(createProperties: TidyTabs.ActiveTabCreateProperties) {
    // TODO: validate createProperties
    const id = createProperties.id || uuidv4();
    return {
      ...createProperties,
      id,
    } as TidyTabs.ActiveTab;
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
