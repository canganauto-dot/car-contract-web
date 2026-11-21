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
  const archive = await getDB("contractArchive");
  if (archive?.entries) {
    const retained = archive.entries.filter(
      (entry) =>
        !RemovedTestData.entryIds.includes(entry.id) && !matches(entry.data),
    );
    if (retained.length !== archive.entries.length) {
      const used = new Set(
        retained.flatMap(entry => [entry, ...(entry.history || [])]).map(entry => entry.configKey).filter(Boolean),
      );
      archive.entries = retained;
      archive.configs = Object.fromEntries(
        Object.entries(archive.configs || {}).filter(([key]) => used.has(key)),
      );
      await putDB("contractArchive", archive);
    }
  }
  const draft = await getDB("draft");
  if (matches(draft)) await putDB("draft", null);
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
