import { BadRequestException, Injectable, type PipeTransform } from "@nestjs/common";
@Injectable() export class UuidValidationPipe implements PipeTransform<string,string> { transform(value:string){ if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new BadRequestException({status:"invalid_request"}); return value; } }
