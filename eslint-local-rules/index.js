/** @type {import("eslint").Rule.RuleModule} */
const pureFunctionType = {
  create(context) {
    return {
      FunctionExpression: (node) => {
        if (node.parent && node.parent.type === "VariableDeclarator") {
          const variableDeclarator = node.parent;
          if (variableDeclarator.id.typeAnnotation) {
            const typeAnnotation =
              variableDeclarator.id.typeAnnotation.typeAnnotation;
            // 型アノテーションがPureFunctionTypeであるかチェックします
            if (
              typeAnnotation.type === "TSTypeReference" &&
              typeAnnotation.typeName.name === "PureFunctionType"
            ) {
              context.report({
                node: node,
                message:
                  'Do not use "state" variable inside PureFunctionType function',
              });
              // node.body.body.forEach((bodyNode) => {
              //   if (
              //     bodyNode.type === "ExpressionStatement" &&
              //     bodyNode.expression.type === "CallExpression"
              //   ) {
              //     bodyNode.expression.arguments.forEach((arg) => {
              //       if (arg.type === "Identifier" && arg.name === "state") {
              //         context.report({
              //           node: arg,
              //           message:
              //             'Do not use "state" variable inside PureFunctionType function',
              //         });
              //       }
              //     });
              //   }
              // });
            }
          }
        }
      },
    };
  },
};

module.exports = {
  "pure-function-type": pureFunctionType,
};
