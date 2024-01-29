import { TidyTabs } from "./types";
import * as Utils from "./utils";

(async function main() {
  chrome.tabGroups.onUpdated.addListener(onTabGroupsUpdated);

  const dataModel = await Utils.DataModel.initializeDataModel();
})();

async function onTabGroupsUpdated(tabGroup: chrome.tabGroups.TabGroup) {
  console.log(`onTabGroupsUpdated::tabGroup: ${tabGroup}`);
  const dataModel = await Utils.DataModel.useOrGetDataModel();

  // find the active space that contains the tab group
  let activeSpaceTabGroupType: "primary" | "secondary" | undefined;
  const activeSpace = dataModel.activeSpaces.find((space) => {
    const { activeData } = space;
    if (!activeData) {
      return false;
    }

    if (activeData.windowId !== tabGroup.windowId) {
      return false;
    }

    if (activeData.primaryTabGroup.id === tabGroup.id) {
      activeSpaceTabGroupType = "primary";
      return true;
    } else if (activeData.secondaryTabGroup.id === tabGroup.id) {
      activeSpaceTabGroupType = "secondary";
      return true;
    }

    return false;
  });

  if (!activeSpace || !activeSpace.activeData) {
    return;
  }

  const { activeData } = activeSpace;

  /*
    1 if: the updated tab group is the secondary tab group:
      1.1 if: the tab group was expanded:
        1.1.1 if: the active tab is in the primary tab group:
          1.1.1.1 do: activate the active tab candidate in the secondary tab group
      1.2 if: the tab group was collapsed:
  */

  // if #1
  if (activeSpaceTabGroupType === "secondary") {
    // if #1.1
    if (Utils.Misc.tabGroupWasExpanded(tabGroup, activeData.secondaryTabGroup)) {
      const { activeTab, primaryTabGroup } = activeData;

      const primaryTabs = Utils.Misc.getTabsWithIds(
        await chrome.tabs.query({ windowId: activeData.windowId, groupId: primaryTabGroup.id })
      );

      if (!Utils.TidyTabsShapeValidator.validatePrimaryTabs(primaryTabs)) {
        onSpaceNotInTidyTabsShape(activeSpace);
        return;
      }

      // if #1.1.1
      if (activeTab && activeTab.id === primaryTabs[0].id) {
        // do #1.1.1.1
        const { secondaryTabGroup } = activeData;
        const secondaryTabs = Utils.Misc.getTabsWithIds(
          await chrome.tabs.query({ windowId: activeData.windowId, groupId: secondaryTabGroup.id })
        );

        if (!Utils.TidyTabsShapeValidator.validateSecondaryTabs(secondaryTabs)) {
          onSpaceNotInTidyTabsShape(activeSpace);
          return;
        }

        const activeTabCandidate = secondaryTabs[0];
        await chrome.tabs.update(activeTabCandidate.id, { active: true });
      }
    }
  }

  await Utils.DataModel.syncActiveSpaceWithWindow({
    windowId: tabGroup.windowId,
    activeSpace,
    type: "tabGroup",
    data: tabGroup,
  });
}

function onSpaceNotInTidyTabsShape(space: TidyTabs.Space) {
  // TODO: implement this
  console.log(`onSpaceNotInTidyTabsShape::space: ${space}`);
}
