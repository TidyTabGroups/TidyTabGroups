import { TidyTabs } from "./types";
import * as Utils from "./utils";

(async function main() {
  chrome.tabGroups.onUpdated.addListener(onTabGroupsUpdated);

  const dataModel = await Utils.DataModel.initializeDataModel();
})();

async function onTabGroupsUpdated(tabGroup: chrome.tabGroups.TabGroup) {
  console.log(`onTabGroupsUpdated::tabGroup: ${tabGroup}`);
  const dataModel = await Utils.DataModel.useOrGetDataModel();

  const activeSpaceFindResult = await Utils.DataModel.findActiveSpaceForChromeObject<"tabGroup">(
    tabGroup.windowId,
    tabGroup,
    dataModel
  );

  if (!activeSpaceFindResult) {
    return;
  }

  const { activeSpace, type: activeSpaceTabGroupType } = activeSpaceFindResult;
  const { activeData } = activeSpace;

  if (!activeData) {
    // TODO: get rid of this once the activeData property on an "active" space is non optional
    const errorMessage = `onTabGroupsUpdated::activeSpace ${activeSpace.id} has no activeData`;
    console.error(errorMessage);
    throw new Error(errorMessage);
    return;
  }

  /*
    1 if: the updated tab group is the secondary tab group:
      1.1 if: the tab group was expanded:
        1.1.1 if: the active tab is in the primary tab group:
          1.1.1.1 do: activate the active tab candidate in the secondary tab group
      1.2 if: the tab group was collapsed:
        1.2.1 do: activate the active tab candidate in the primary tab group
  */

  // if #1
  if (activeSpaceTabGroupType === "secondaryTabGroup") {
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
