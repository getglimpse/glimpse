export default function activate(ctx) {
  ctx.registerAction("hello", (name = "Glimpse") => {
    const value = String(name || "Glimpse").trim();

    return ctx.i18n.t("actions.hello.result", "Hello, {name}!").replace(
      "{name}",
      value,
    );
  });

  ctx.registerPage("plugin:valid-basic-plugin", ({ h, components }) => {
    const { Stack, Text, Section, KeyValueList } = components;

    return h(
      Stack,
      { gap: "md" },
      h(Text, { variant: "muted" }, "Rendered from valid-basic-plugin."),
      h(
        Section,
        { title: "Runtime" },
        h(KeyValueList, {
          rows: [
            ["Plugin ID", ctx.plugin.id],
            ["API", ctx.api.version],
            ["Action", "hello"],
          ],
        }),
      ),
    );
  });
}
