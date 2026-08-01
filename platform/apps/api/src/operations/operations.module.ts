import { Module } from '@nestjs/common';
import { OperationsController } from './operations.controller.js';

/** Statusabfrage asynchroner Operationen (202-Accepted-Muster, Scale S1). */
@Module({ controllers: [OperationsController] })
export class OperationsModule {}
