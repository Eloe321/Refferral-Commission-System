/* eslint-disable @typescript-eslint/no-extraneous-class */
import {Module} from "@nestjs/common";import {ProgramsController} from "./programs.controller.js";import {ProgramsService} from "./programs.service.js";@Module({controllers:[ProgramsController],providers:[ProgramsService]})export class ProgramsModule{}
