export default function activate(ctx) {
  const math = ctx.math.create(ctx.math.all, {});

  math.import(
    {
      import: () => {
        throw new Error("import is disabled");
      },
      createUnit: () => {
        throw new Error("createUnit is disabled");
      },
    },
    { override: true },
  );

  ctx.registerAction("calculate", (expression) => {
    const source = String(expression ?? "").trim();

    if (!source) {
      throw new Error("Expression is required");
    }

    if (source.length > MAX_EXPRESSION_LENGTH) {
      throw new Error(
        `Expression must be ${MAX_EXPRESSION_LENGTH} characters or less`,
      );
    }

    assertSafeExpression(math.parse(source));

    const result = math.evaluate(source);

    if (typeof result === "number" && !Number.isFinite(result)) {
      throw new Error("Invalid result");
    }

    const resultText = String(result);

    if (resultText.length > MAX_RESULT_LENGTH) {
      throw new Error(
        `Result is too large to display; limit is ${MAX_RESULT_LENGTH} characters`,
      );
    }

    return resultText;
  });

  ctx.registerPage("plugin:numeric-calculator-plugin", ({ h, components }) => {
    const { Stack, Text, CalculationPanel, Section, KeyValueList } = components;

    return h(
      Stack,
      { gap: "md" },
      h(Text, { variant: "muted" }, "Fixture numeric calculator."),
      h(CalculationPanel, {
        action: "calculate",
        input: {
          placeholder: "1 + 1",
        },
        result: {
          copyable: true,
          history: true,
        },
        examples: ["1 + 1", "sqrt(144)", "pow(2, 8)"],
      }),
      h(
        Section,
        { title: "Runtime" },
        h(KeyValueList, {
          rows: [
            ["Plugin ID", ctx.plugin.id],
            ["Action", "calculate"],
            ["Layout", "Core components"],
          ],
        }),
      ),
    );
  });
}

const MAX_EXPRESSION_LENGTH = 512;
const MAX_RESULT_LENGTH = 4096;
const BLOCKED_NODE_TYPES = new Set([
  "AssignmentNode",
  "FunctionAssignmentNode",
]);
const BLOCKED_FUNCTIONS = new Set([
  "compile",
  "config",
  "createUnit",
  "evaluate",
  "import",
  "parse",
  "parser",
]);

function assertSafeExpression(node) {
  node.traverse((child) => {
    if (BLOCKED_NODE_TYPES.has(child.type)) {
      throw new Error("Assignments and function definitions are disabled");
    }

    if (child.type !== "FunctionNode") {
      return;
    }

    const functionName = child.fn?.name;

    if (typeof functionName === "string" && BLOCKED_FUNCTIONS.has(functionName)) {
      throw new Error(`${functionName} is disabled`);
    }
  });
}
