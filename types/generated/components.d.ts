import type { Schema, Struct } from '@strapi/strapi';

export interface RecipeIngredient extends Struct.ComponentSchema {
  collectionName: 'components_recipe_ingredients';
  info: {
    description: 'Recipe ingredient with raw material relation';
    displayName: 'Ingredient';
  };
  attributes: {
    quantity: Schema.Attribute.Decimal &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<0>;
    rawMaterial: Schema.Attribute.Relation<
      'oneToOne',
      'api::raw-material.raw-material'
    >;
    unit: Schema.Attribute.Enumeration<['liter', 'kg', 'gram', 'ml', 'piece']> &
      Schema.Attribute.DefaultTo<'liter'>;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'recipe.ingredient': RecipeIngredient;
    }
  }
}
