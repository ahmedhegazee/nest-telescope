import { Entity, Column, PrimaryColumn, CreateDateColumn, Index } from 'typeorm';

@Entity('telescope_entries')
@Index(['type', 'timestamp'])
@Index(['familyHash'])
@Index(['timestamp'])
export class TelescopeEntryEntity {
  @PrimaryColumn('varchar', { length: 255 })
  id: string;

  @Column('varchar', { length: 100 })
  @Index()
  type: string;

  @Column('varchar', { length: 255 })
  familyHash: string;

  @Column('json')
  content: Record<string, any>;

  @Column('simple-array')
  tags: string[];

  @CreateDateColumn()
  @Index()
  timestamp: Date;

  @Column('bigint')
  sequence: number;

  @Column('varchar', { length: 255, nullable: true })
  batchId?: string;

  @CreateDateColumn()
  createdAt: Date;

  @Column('varchar', { length: 100, nullable: true })
  @Index()
  userId?: string;

  @Column('varchar', { length: 255, nullable: true })
  sessionId?: string;

  @Column('varchar', { length: 50, nullable: true })
  environment?: string;

  @Column('text', { nullable: true })
  metadata?: string;
}