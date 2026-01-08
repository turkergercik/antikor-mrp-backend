'use strict';

module.exports = {
  async findIndex(ctx) {
    try {
      const { id } = ctx.params;
      
      // Get the cargo company to find its createdAt timestamp
      const cargoCompany = await strapi.entityService.findOne('api::cargo-company.cargo-company', id, {
        fields: ['id', 'createdAt'],
      });
      
      if (!cargoCompany) {
        return ctx.notFound('Cargo company not found');
      }
      
      // Count how many cargo companies were created before this one
      const db = strapi.db;
      const result = await db.query('api::cargo-company.cargo-company').count({
        where: {
          createdAt: {
            $lt: cargoCompany.createdAt,
          },
        },
      });
      
      ctx.send({
        index: result,
        cargoCompanyId: id,
        createdAt: cargoCompany.createdAt,
      });
    } catch (err) {
      ctx.throw(500, err);
    }
  },
};
