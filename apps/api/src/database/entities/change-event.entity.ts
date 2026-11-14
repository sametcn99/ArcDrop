import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.entity';

/** What happened to the entity. `delete` is only ever a HARD delete (trash is an `update`). */
export type ChangeAction = 'create' | 'update' | 'delete';

/** Entity types recorded in the change log (plan D4; `collection` from M4; `highlight` from M10). */
export type ChangeEntity = 'bookmark' | 'tag' | 'collection' | 'highlight';

/** Payload pushed on the in-process bus after commit (M5's ws fan-out consumes it). */
export interface ChangeEventNotification {
  userId: string;
  seq: string;
  entity: ChangeEntity;
  entityId: string;
  action: ChangeAction;
  occurredAt: Date;
}

/**
 * One row per mutation of a user's data (plan D4 — change log from day one).
 * Appended IN THE SAME TRANSACTION as the mutation by `ChangeLogService`,
 * with a gapless per-user `seq` taken from an atomic `users.sync_seq`
 * increment. M5 reads this table for `/sync/changes`; the row itself carries
 * no payload — the delta endpoint re-reads the entity (tombstones are the
 * `delete` rows).
 */
@Entity({ name: 'change_events' })
@Index('UX_change_events_user_seq', ['userId', 'seq'], { unique: true })
@Index('IX_change_events_user_created', ['userId', 'createdAt'])
export class ChangeEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  @JoinColumn({ name: 'user_id' })
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  userId!: string;

  /** Per-user monotonic, gapless (serialized on the `users` row lock). */
  @Column({ type: 'bigint' })
  seq!: string;

  @Column({
    type: 'enum',
    enum: ['bookmark', 'tag', 'collection', 'highlight'],
    enumName: 'change_entity',
  })
  entity!: ChangeEntity;

  @Column({ type: 'uuid', name: 'entity_id' })
  entityId!: string;

  @Column({ type: 'enum', enum: ['create', 'update', 'delete'], enumName: 'change_action' })
  action!: ChangeAction;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
