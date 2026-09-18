/* eslint-disable @typescript-eslint/no-extraneous-class */
import{Module}from"@nestjs/common";import{PartnersController}from"./partners.controller.js";import{PartnersService}from"./partners.service.js";@Module({controllers:[PartnersController],providers:[PartnersService]})export class PartnersModule{}
