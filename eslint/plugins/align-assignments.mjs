/**
 * Wrapper local de eslint-plugin-align-assignments.
 *
 * ESLint 10 eliminó el método deprecado context.getSourceCode(), que el plugin
 * (última publicación 2017) sigue usando. Este wrapper lo reintroduce usando
 * context.sourceCode, manteniendo intacto el comportamiento de la regla.
 */
import alignAssignments from 'eslint-plugin-align-assignments';

const rule = alignAssignments.rules['align-assignments'];

const compatRule = {
  meta: { ...rule.meta },
  create(context) {
    const updatedContext = {
      ...context,
      getSourceCode() {
        return context.sourceCode;
      },
    };
    return rule.create(updatedContext);
  },
};

export default {
  meta: { name: 'align-assignments' },
  rules: {
    'align-assignments': compatRule,
  },
};