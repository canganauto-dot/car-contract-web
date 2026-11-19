// Only the three records confirmed as test data are removed from existing browser storage.
const RemovedTestData = {
  entryIds: [
    "draft:contract-f2512d3d-47b6-4db8-8e0e-e1988d513ad3",
    "printed:contract-60ce7895-93cf-497d-9612-7100b0cbc5ce",
    "printed:contract-0be5801d-a911-4042-9f25-898f9e5776a1",
  ],
  recordIds: [
    "contract-f2512d3d-47b6-4db8-8e0e-e1988d513ad3",
    "contract-60ce7895-93cf-497d-9612-7100b0cbc5ce",
    "contract-0be5801d-a911-4042-9f25-898f9e5776a1",
  ],
};

async function removeTestArchives() {
  const matches = (data) => RemovedTestData.recordIds.includes(data?.recordId);
  await updateArchive(archive => {
    if (!archive?.entries) return;
    const retained = archive.entries.filter(
      (entry) =>
        !RemovedTestData.entryIds.includes(entry.id) && !matches(entry.data),
    );
    if (retained.length === archive.entries.length) return;
    const used = new Set(retained.map(entry => entry.configKey).filter(Boolean));
    return {
      ...archive,
      entries: retained,
      configs: Object.fromEntries(Object.entries(archive.configs || {}).filter(([key]) => used.has(key))),
    };
  }, undefined, RemovedTestData.recordIds.map(id => "draft:" + id));
  const open = await getDB("openWork");
  if (Array.isArray(open) && open.some(matches))
    await putDB(
      "openWork",
      open.filter((item) => !matches(item)),
    );
  const backups = await getDB("backups");
  if (Array.isArray(backups) && backups.some((item) => matches(item.data))) {
    await putDB(
      "backups",
      backups.map((item) =>
        matches(item.data) ? { ...item, data: null } : item,
      ),
    );
  }
}
